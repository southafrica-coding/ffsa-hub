import { NextResponse } from "next/server";
import { dbError, getCaller, jsonError, present, type Caller } from "@/lib/evangelism/http";
import { parsePhoto, parseReview, parseTestimonyFields } from "@/lib/evangelism/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  attachPhoto,
  deletePhotoRows,
  deleteTestimony,
  getTestimony,
  publishTestimony,
  removePhotoObjects,
  updateTestimony,
  withholdTestimony,
  type TestimonyRow,
} from "@/services/evangelism";

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Loaded = { res: Response } | { caller: Caller; row: TestimonyRow };

async function load(id: string): Promise<Loaded> {
  const caller = await getCaller();
  if (caller instanceof NextResponse) return { res: caller };
  if (!caller.access.view) return { res: jsonError(403, "You don't have access to Evangelism.") };
  if (!UUID.test(id)) return { res: jsonError(404, "Story not found.") };
  // Read with the caller's client: a story RLS hides is simply "not found".
  const { data, error } = await getTestimony(caller.supabase, id);
  if (error) return { res: dbError(error, "get") };
  if (!data) return { res: jsonError(404, "Story not found.") };
  return { caller, row: data };
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
  const { caller, row } = loaded;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError(400, "Send the change as JSON.");

  // ── Review ──
  if (body.action !== undefined) {
    if (!caller.access.publish) return jsonError(403, "Only publishers can publish or withhold.");
    const review = parseReview(body);
    if (!review.ok) return jsonError(400, review.error);
    if (review.value.action === "publish" && !row.consent_to_share) {
      return jsonError(400, "This story has no consent to share, so it can't be published.", "consent_required");
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
  if (!caller.access.submit || row.author_user_id !== caller.userId) {
    return jsonError(403, "Only the author can edit this story.");
  }
  if (row.status !== "draft" && row.status !== "submitted") {
    return jsonError(409, "This story has been reviewed and can no longer be edited.");
  }
  const submit = body.intent === "submit";
  const fields = parseTestimonyFields(body, { submit });
  if (!fields.ok) return jsonError(400, fields.error, fields.code);
  const photo = parsePhoto(body.photo, caller.userId);
  if (!photo.ok) return jsonError(400, photo.error);

  const { data: updated, error } = await updateTestimony(
    caller.supabase,
    id,
    fields.value,
    submit ? "submitted" : "draft"
  );
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
        await removePhotoObjects(createAdminClient(), existing.map((m) => m.storage_path));
      } catch (e) {
        console.error("[evangelism] remove old photo object", e);
      }
    }
  }
  let photoError: string | undefined;
  if (photo.value) {
    const { error: mediaError } = await attachPhoto(caller.supabase, id, caller.userId, photo.value);
    if (mediaError) {
      console.error("[evangelism] attach photo", mediaError);
      photoError = "The story saved, but the photo didn't attach.";
    }
  }

  const { data: fresh } = await getTestimony(caller.supabase, id);
  const [out] = await present([fresh ?? updated], caller);
  return NextResponse.json({ testimony: out, ...(photoError ? { photo_error: photoError } : {}) });
}

// DELETE /api/evangelism/testimonies/:id
//   The author may delete their own draft; a publisher may delete any story.
//   Storage objects go first (service role), then the row (caller's client).
export async function DELETE(_request: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const loaded = await load(id);
  if ("res" in loaded) return loaded.res;
  const { caller, row } = loaded;

  const ownDraft = row.author_user_id === caller.userId && row.status === "draft" && caller.access.submit;
  if (!caller.access.publish && !ownDraft) {
    return jsonError(403, "Only drafts can be deleted by their author.");
  }

  const paths = (row.evangelism_media ?? []).map((m) => m.storage_path);
  if (paths.length > 0) {
    try {
      await removePhotoObjects(createAdminClient(), paths);
    } catch (e) {
      console.error("[evangelism] remove photo objects", e);
    }
  }
  const { deleted, error } = await deleteTestimony(caller.supabase, id);
  if (error) return dbError(error, "delete");
  if (deleted === 0) return jsonError(403, "You don't have permission to delete this story.");
  return NextResponse.json({ ok: true });
}
