import { createAdminClient } from "@/lib/supabase/admin";
import { getRateLimiter, retryAfterSeconds } from "@/lib/rate-limit";
import {
  EVANGELISM_MEDIA_BUCKET,
  PHOTO_MAX_BYTES,
  VIDEO_MAX_BYTES,
  buildMediaPath,
  validateSignMedia,
} from "@/lib/evangelism/contract";
import { guardEvangelism, isGuard, json, notEnabled, readBody } from "@/lib/evangelism/http";
import { isEvangelismNotReady } from "@/lib/evangelism/schema-error";

// POST /api/evangelism/media/sign
//   { kind: "photo" | "video", content_type, size }
// → { bucket, path, signed_url, token }
//
// The browser PUTs the file to signed_url, then includes `path` on
// POST /api/evangelism/testimonies. Anonymous /api/upload/sign is not used:
// that route only signs school-application photos.

const MAX_PER_WINDOW = 30;
const WINDOW_SECONDS = 60;

export async function POST(request: Request) {
  const guard = await guardEvangelism();
  if (isGuard(guard)) return guard.response;
  const { user, access } = guard;
  if (!access.submit) {
    return json({ error: "forbidden", message: "You cannot upload testimony files." }, 403);
  }

  const limit = await getRateLimiter().hit(`evangelism-media:${user.id}`, {
    limit: MAX_PER_WINDOW,
    windowSeconds: WINDOW_SECONDS,
  });
  if (!limit.allowed) {
    return json(
      { error: "rate_limited", message: "Too many uploads at once. Wait a minute and try again." },
      429,
      { "Retry-After": String(retryAfterSeconds(limit)) }
    );
  }

  const parsed = validateSignMedia((await readBody(request)) as { kind?: unknown; content_type?: unknown; size?: unknown });
  if (!parsed.ok) return json({ error: "bad_request", message: parsed.message }, 400);

  const path = buildMediaPath(user.id, parsed.contentType, crypto.randomUUID());
  if (!path) return json({ error: "bad_request", message: "Could not build an upload path." }, 400);

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return notEnabled();
  }
  const { data, error } = await admin.storage.from(EVANGELISM_MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    if (isEvangelismNotReady(error)) return notEnabled();
    console.error("[evangelism] signed upload failed", error?.message ?? "");
    return json({ error: "server_error", message: "Couldn't start the upload." }, 500);
  }

  return json({
    bucket: EVANGELISM_MEDIA_BUCKET,
    path,
    signed_url: data.signedUrl,
    token: data.token,
    content_type: parsed.contentType,
    max_bytes: parsed.kind === "photo" ? PHOTO_MAX_BYTES : VIDEO_MAX_BYTES,
  });
}
