import { NextResponse } from "next/server";
import { dbError, getCaller, jsonError, present, type Caller } from "@/lib/evangelism/http";
import { parsePhoto, parseReview, parseTestimonyFields } from "@/lib/evangelism/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  attachPhoto,
  deletePhotoRows,
  deleteTestimony,
  getAttribution,
  getTestimony,
  mediaPaths,
  ownedUploadPaths,
  publishTestimony,
  removePhotoObjects,
  updateTestimony,
  withholdTestimony,
  type TestimonyRow,
} from "@/services/evangelism";

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Loaded = { res: Response } | { caller: Caller; row: TestimonyRow; isMine: boolean };

async function load(id: string): Promise<Loaded> {
  const caller = await getCaller();
  if (caller instanceof NextResponse) return { res: caller };
  if (!caller.access.view) return { res: jsonError(403, "You don't have access to Evangelism.") };
  if (!UUID.test(id)) return { res: jsonError(404, "Story not found.") };
  // Read with the caller's client: a story RLS hides is simply "not found".
  const { data, error } = await getTestimony(caller.supabase, id);
  if (error) return { res: dbError(error, "get") };
  if (!data) return { res: jsonError(404, "Story not found.") };
  // author_user_id isn't readable; the database says whether it's ours.
  const { data: attribution } = await getAttribution(caller.supabase, [id]);
  return { caller, row: data, isMine: attribution.get(id)?.is_mine === true };
}

/** Best-effort removal of storage objects (service role). */
async function removeObjects(paths: string[]) {
  if (paths.length === 0) return;
  try {
    await removePhotoObjects(createAdminClient(), paths);
  } catch (e) {
    console.error("[evangelism] remove photo objects", e);
  }
}

// GET /api/evangelism/testimonies/:id
export async function GET(_request: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const loaded = await load(id);
  if ("res" in loaded) return loaded.res;
  const [out] = await present([loaded.row], loaded.caller);
  return NextResponse.json({ testimony: out });
}

// PATCH /api/evangelism/testimonies/:id
//   Publisher:  { action: "publish" } | { action: "withhold", reason? }
//   Author:     { ...fields, intent: "draft" | "submit", photo?, remove_photo? }
//               while the story is still draft or submitted.
export async function PATCH(request: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const loaded = await load(id);
  if ("res" in loaded) return loaded.res;
  const { caller, row, isMine } = loaded;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError(400, "Send the change as JSON.");

  // ── Review ──
  if (body.action !== undefined) {
    if (!caller.access.publish) return jsonError(403, "Only publishers can publish or withhold.");
    const review = parseReview(body);
    if (!review.ok) return jsonError(400, review.error);
    if (review.value.action === "publish") {
      if (!row.consent_to_share) {
        return jsonError(400, "This story has no consent to share, so it can't be published.", "consent_required");
      }
      if (row.status !== "submitted" && row.status !== "withheld") {
        return jsonError(409, "Only a story that was submitted for review can be published.");
      }
    }
    const { data, error } =
      review.value.action === "publish"
        ? await publishTestimony(caller.supabase, id)
        : await withholdTestimony(caller.supabase, id, review.value.reason);
    if (error || !data) return dbError(error, review.value.action);
    const [out] = await present([data], caller);
    return NextResponse.json({ testimony: out });
  }

  // ── Author edit ──
  if (!caller.access.submit || !isMine) {
    return jsonError(403, "Only the author can edit this story.");
  }
  if (row.status !== "draft" && row.status !== "submitted") {
    return jsonError(409, "This story has been reviewed and can no longer be edited.");
  }
  const submit = body.intent === "submit";
  const fields = parseTestimonyFields(body, { submit });
  if (!fields.ok) return jsonError(400, fields.error, fields.code);
  const photo = parsePhoto(body.photo);
  if (!photo.ok) return jsonError(400, photo.error);

  const { data: updated, error } = await updateTestimony(caller.supabase, id, fields.value, submit ? "submitted" : "draft");
  if (error || !updated) return dbError(error, "update");

  // One photo per story: a new photo or remove_photo replaces the old one.
  const existing = row.evangelism_media ?? [];
  if ((photo.value || body.remove_photo === true) && existing.length > 0) {
    const { error: delError } = await deletePhotoRows(
      caller.supabase,
      existing.map((m) => m.id)
    );
    if (!delError) {
      try {
        const admin = createAdminClient();
        const paths = [...(await mediaPaths(admin, existing.map((m) => m.id))).values()];
        // Only objects the ledger says this caller minted.
        await removePhotoObjects(admin, await ownedUploadPaths(admin, paths, caller.userId));
      } catch (e) {
        console.error("[evangelism] remove old photo object", e);
      }
    }
  }
  let photoError: string | undefined;
  if (photo.value) {
    const { error: mediaError } = await attachPhoto(caller.supabase, id, photo.value);
    if (mediaError) {
      console.error("[evangelism] attach photo", mediaError);
      photoError = "The story saved, but the photo didn't attach.";
      try {
        const admin = createAdminClient();
        await removePhotoObjects(admin, await ownedUploadPaths(admin, [photo.value.path], caller.userId));
      } catch {
        /* orphan object; harmless in a private bucket */
      }
    }
  }

  const { data: fresh } = await getTestimony(caller.supabase, id);
  const [out] = await present([fresh ?? updated], caller);
  return NextResponse.json({ testimony: out, ...(photoError ? { photo_error: photoError } : {}) });
}

// DELETE /api/evangelism/testimonies/:id
//   The author may delete their own draft; a publisher may delete any story.
//   The row goes first (caller's client, so RLS decides); only once exactly
//   one row is gone are its storage objects removed with the service role.
export async function DELETE(_request: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const loaded = await load(id);
  if ("res" in loaded) return loaded.res;
  const { caller, row, isMine } = loaded;

  const ownDraft = isMine && row.status === "draft" && caller.access.submit;
  if (!caller.access.publish && !ownDraft) {
    return jsonError(403, "Only drafts can be deleted by their author.");
  }

  // Look the paths up now: the cascade removes the media rows with the story.
  const mediaIds = (row.evangelism_media ?? []).map((m) => m.id);
  let paths: string[] = [];
  if (mediaIds.length > 0) {
    try {
      paths = [...(await mediaPaths(createAdminClient(), mediaIds)).values()];
    } catch (e) {
      console.error("[evangelism] look up photo paths", e);
    }
  }

  const { deleted, error } = await deleteTestimony(caller.supabase, id);
  if (error) return dbError(error, "delete");
  if (deleted !== 1) return jsonError(403, "You don't have permission to delete this story.");

  await removeObjects(paths);
  return NextResponse.json({ ok: true });
}
