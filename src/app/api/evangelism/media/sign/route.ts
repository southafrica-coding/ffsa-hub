import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCaller, jsonError } from "@/lib/evangelism/http";
import { checkPhoto, photoPathFor } from "@/lib/evangelism/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { EVANGELISM_BUCKET, isEvangelismNotReady, recordUpload } from "@/services/evangelism";

// POST /api/evangelism/media/sign   { content_type, size }
//   → { path, token, signed_url, content_type }
// Mints a one-off signed upload into the PRIVATE evangelism-media bucket at
// testimonies/{uuid}/{uuid}.{ext} — no user id in the path, because signed
// read URLs carry it to view-only users. The path is recorded against the
// caller in evangelism_uploads (service role); the media insert policy only
// accepts a path the ledger says the caller minted.
export async function POST(request: Request) {
  const caller = await getCaller();
  if (caller instanceof NextResponse) return caller;
  if (!caller.access.submit) return jsonError(403, "You can't upload story photos.");

  const body = (await request.json().catch(() => null)) as { content_type?: unknown; size?: unknown } | null;
  const checked = checkPhoto(body?.content_type, body?.size);
  if (!checked.ok) return jsonError(400, checked.error);

  const admin = createAdminClient();
  const path = photoPathFor(randomUUID(), randomUUID(), checked.value.ext);

  const { error: ledgerError } = await recordUpload(admin, path, caller.userId);
  if (ledgerError) {
    if (isEvangelismNotReady(ledgerError)) {
      return jsonError(503, "Evangelism isn't switched on yet.", "evangelism_not_enabled");
    }
    console.error("[evangelism] record upload", ledgerError);
    return jsonError(500, "Couldn't prepare the photo upload.");
  }

  const { data, error } = await admin.storage.from(EVANGELISM_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    if (isEvangelismNotReady(error)) {
      return jsonError(503, "Evangelism isn't switched on yet.", "evangelism_not_enabled");
    }
    console.error("[evangelism] sign upload", error);
    return jsonError(500, "Couldn't prepare the photo upload.");
  }
  return NextResponse.json({
    path,
    token: data.token,
    signed_url: data.signedUrl,
    content_type: checked.value.contentType,
  });
}
