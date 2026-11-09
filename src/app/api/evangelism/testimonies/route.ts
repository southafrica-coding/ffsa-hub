import { NextResponse } from "next/server";
import { dbError, getCaller, jsonError, present } from "@/lib/evangelism/http";
import { parsePhoto, parseTestimonyFields } from "@/lib/evangelism/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  attachPhoto,
  createTestimony,
  getTestimony,
  listTestimonies,
  ownedUploadPaths,
  removePhotoObjects,
  type TestimonyStatus,
} from "@/services/evangelism";

const TEAM_STATUSES: TestimonyStatus[] = ["draft", "submitted", "withheld"];

// GET /api/evangelism/testimonies
//   (default)          published stories — any view access
//   ?mine=1            the caller's own stories (incl. withheld) — submit access
//   ?status=submitted  team review list (also draft / withheld) — publish only
export async function GET(request: Request) {
  const caller = await getCaller();
  if (caller instanceof NextResponse) return caller;
  if (!caller.access.view) return jsonError(403, "You don't have access to Evangelism.");

  const url = new URL(request.url);
  const mine = url.searchParams.get("mine") === "1";
  const status = (url.searchParams.get("status") ?? (mine ? "" : "published")) as TestimonyStatus | "";
  const limit = Number(url.searchParams.get("limit")) || 50;

  if (status && status !== "published" && !TEAM_STATUSES.includes(status)) {
    return jsonError(400, "Unknown status.");
  }
  if (mine && !caller.access.submit) return jsonError(403, "You can't submit stories.");
  if (!mine && status && TEAM_STATUSES.includes(status) && !caller.access.publish) {
    return jsonError(403, "Only publishers can see the review list.");
  }

  const { data, error } = await listTestimonies(caller.supabase, {
    status: status || undefined,
    mine,
    limit,
  });
  if (error) return dbError(error, "list");
  return NextResponse.json({ testimonies: await present(data, caller) });
}

// POST /api/evangelism/testimonies
//   { ...fields, intent: "draft" | "submit", photo?: { path, content_type, size } }
// The photo must already be uploaded through /api/evangelism/media/sign.
export async function POST(request: Request) {
  const caller = await getCaller();
  if (caller instanceof NextResponse) return caller;
  if (!caller.access.submit) return jsonError(403, "You can't submit stories.");

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError(400, "Send the story as JSON.");
  const submit = body.intent === "submit";

  const fields = parseTestimonyFields(body, { submit });
  if (!fields.ok) return jsonError(400, fields.error, fields.code);
  const photo = parsePhoto(body.photo);
  if (!photo.ok) return jsonError(400, photo.error);

  const { data: created, error } = await createTestimony(caller.supabase, fields.value, submit ? "submitted" : "draft");
  if (error || !created) return dbError(error, "create");

  let photoError: string | undefined;
  if (photo.value) {
    const { error: mediaError } = await attachPhoto(caller.supabase, created.id, photo.value);
    if (mediaError) {
      console.error("[evangelism] attach photo", mediaError);
      photoError = "The story saved, but the photo didn't attach. Edit the story to try again.";
      // The path came from the client: only clean it up if the ledger says
      // this caller minted it, so nobody can delete another user's photo.
      try {
        const admin = createAdminClient();
        await removePhotoObjects(admin, await ownedUploadPaths(admin, [photo.value.path], caller.userId));
      } catch {
        /* orphan object; harmless in a private bucket */
      }
    }
  }

  const { data: fresh } = await getTestimony(caller.supabase, created.id);
  const [out] = await present([fresh ?? created], caller);
  return NextResponse.json({ testimony: out, ...(photoError ? { photo_error: photoError } : {}) }, { status: 201 });
}
