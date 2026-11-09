import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCaller, jsonError } from "@/lib/evangelism/http";
import { checkPhoto, photoPathFor } from "@/lib/evangelism/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { EVANGELISM_BUCKET, isEvangelismNotReady } from "@/services/evangelism";

// POST /api/evangelism/media/sign   { content_type, size }
//   → { path, token, signed_url }
// Mints a one-off signed upload into the PRIVATE evangelism-media bucket at
// testimonies/{caller}/{uuid}.{ext}. The bucket has no storage.objects
// policies; this route (service role) is the only way in. The client then
// sends { path, content_type, size } as `photo` on the testimony create/edit,
// where RLS checks the path belongs to the caller.
export async function POST(request: Request) {
  const caller = await getCaller();
  if (caller instanceof NextResponse) return caller;
  if (!caller.access.submit) return jsonError(403, "You can't upload story photos.");

  const body = (await request.json().catch(() => null)) as { content_type?: unknown; size?: unknown } | null;
  const checked = checkPhoto(body?.content_type, body?.size);
  if (!checked.ok) return jsonError(400, checked.error);

  const path = photoPathFor(caller.userId, randomUUID(), checked.value.ext);
  const { data, error } = await createAdminClient().storage.from(EVANGELISM_BUCKET).createSignedUploadUrl(path);
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
