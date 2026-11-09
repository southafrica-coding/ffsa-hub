import { NextResponse } from "next/server";
import { dbError, getCaller, jsonError, present, type Caller } from "@/lib/evangelism/http";
import {
  classifyPatch,
  decideTakedown,
  statusAfterAuthorEdit,
  takedownFromAttribution,
  type TakedownAccess,
} from "@/lib/evangelism/takedown";
import { parsePhoto, parseTestimonyFields } from "@/lib/evangelism/validation";
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

type Loaded =
  | { res: Response }
  | { caller: Caller; row: TestimonyRow; isMine: boolean; withheldByOther: boolean };

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
  // withheld_by_other is absent on main's attribution RPC.
  const { data: attribution } = await getAttribution(caller.supabase, [id]);
  const fromAttr = takedownFromAttribution(attribution.get(id), {
    moderate: (caller.access as TakedownAccess).moderate === true,
    status: data.status,
  });
  return { caller, row: data, isMine: fromAttr.isMine, withheldByOther: fromAttr.withheldByOther };
}

/** maybeSingle() on zero rows is a null, not an error. PGRST116 is the same. */
function wroteNothing(data: unknown, error: unknown): boolean {
  if (data) return false;
  if (!error) return true;
  return (error as { code?: string }).code === "PGRST116";
}

/** A write that changed no row: 403 if we can still see it, otherwise 404. Never 500. */
async function missedWrite(caller: Caller, id: string): Promise<Response> {
  const { data, error } = await getTestimony(caller.supabase, id);
  if (error) return dbError(error, "get");
  if (data) return jsonError(403, "You don't have permission to do that.");
  return jsonError(404, "Story not found.");
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

function takedownAccess(caller: Caller): TakedownAccess {
  const extra = caller.access;
  return {
    submit: caller.access.submit,
    publish: caller.access.publish,
    moderate: extra.moderate,
    unscopedAdmin: extra.unscopedAdmin,
  };
}

// PATCH /api/evangelism/testimonies/:id
//   Review:  { action: "publish" } | { action: "withhold", reason? }
//            or { status: "published" } | { status: "withheld", reason? }
//   Author:  { ...fields, intent: "draft" | "submit", photo?, remove_photo? }
//            while the story is still draft or submitted.
// A status change is decided before the "already reviewed" lock, so a
// publisher can withhold a published story or republish a withheld one.
// Content and consent on a reviewed story stay locked. Who may do a
// review is decideTakedown — the same helper the UI uses.
export async function PATCH(request: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const loaded = await load(id);
  if ("res" in loaded) return loaded.res;
  const { caller, row, isMine, withheldByOther } = loaded;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError(400, "Send the change as JSON.");

  const classified = classifyPatch(body);
  if (classified.kind === "invalid") return jsonError(400, classified.error);
  if (classified.kind === "mixed") {
    // A review that also carries content. On a reviewed story that is the
    // content lock; on an open story we won't silently drop either half.
    if (row.status === "published" || row.status === "withheld") {
      return jsonError(409, "This story has been reviewed and can no longer be edited.");
    }
    return jsonError(400, "Send a review on its own, without changing the story.");
  }

  // ── Review (withhold / republish). Runs before the author-edit lock. ──
  if (classified.kind === "withhold" || classified.kind === "republish") {
    const decision = decideTakedown(
      classified.kind === "withhold" ? "withhold" : "republish",
      takedownAccess(caller),
      {
        isMine,
        status: row.status,
        consentToShare: row.consent_to_share,
        withheldByOther,
      },
    );
    if (!decision.ok) return jsonError(decision.status, decision.error, decision.code);
    const written =
      classified.kind === "republish"
        ? await publishTestimony(caller.supabase, id)
        : await withholdTestimony(caller.supabase, id, classified.reason);
    if (!wroteNothing(written.data, written.error)) {
      if (written.error || !written.data) return dbError(written.error, classified.kind);
    }
    if (!written.data) return missedWrite(caller, id);
    const data = written.data;
    const [out] = await present([data], caller);
    return NextResponse.json({ testimony: out });
  }

  // ── Author edit. 307 locks reviewed stories. 311 keeps their status. ──
  const submit = body.intent === "submit";
  const nextStatus = statusAfterAuthorEdit(row.status, submit);
  if (nextStatus === "locked") {
    return jsonError(409, "This story has been reviewed and can no longer be edited.");
  }
  if (!caller.access.submit || !isMine) {
    return jsonError(403, "Only the author can edit this story.");
  }
  const fields = parseTestimonyFields(body, { submit });
  if (!fields.ok) return jsonError(400, fields.error, fields.code);
  const photo = parsePhoto(body.photo);
  if (!photo.ok) return jsonError(400, photo.error);

  const written = await updateTestimony(caller.supabase, id, fields.value, nextStatus);
  if (!wroteNothing(written.data, written.error)) {
    if (written.error || !written.data) return dbError(written.error, "update");
  }
  if (!written.data) return missedWrite(caller, id);
  const updated = written.data;

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
//   Who may delete is decideTakedown (307: the author may delete their own
//   draft; a publisher may delete any story). The row goes first (caller's
//   client, so RLS decides); only once exactly one row is gone are its
//   storage objects removed with the service role.
export async function DELETE(_request: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const loaded = await load(id);
  if ("res" in loaded) return loaded.res;
  const { caller, row, isMine, withheldByOther } = loaded;

  const decision = decideTakedown("delete", takedownAccess(caller), {
    isMine,
    status: row.status,
    consentToShare: row.consent_to_share,
    withheldByOther,
  });
  if (!decision.ok) return jsonError(decision.status, decision.error, decision.code);

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
