import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, getRateLimiter, retryAfterSeconds } from "@/lib/rate-limit";
import {
  isAcceptableUploadContentType,
  isValidApplicationUploadPath,
  UPLOAD_BUCKET,
} from "@/lib/upload-paths";

// INTENTIONALLY ANONYMOUS. Applicants on /apply have no account, and they
// need a signed URL to upload their photo straight to storage. So this route
// can't ask "who are you"; instead it only signs one narrow shape of path
// (see lib/upload-paths: a fresh uuid per upload, an image extension, no
// traversal), and counts requests per IP.

// A real applicant uploads a handful of photos; 30 a minute per IP leaves
// room for retries and a shared office connection.
const MAX_PER_WINDOW = 30;
const WINDOW_SECONDS = 60;

export async function POST(request: Request) {
  const limit = await getRateLimiter().hit(`upload-sign:${clientIp(request)}`, {
    limit: MAX_PER_WINDOW,
    windowSeconds: WINDOW_SECONDS,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many uploads at once. Wait a minute and try again." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(limit)) } }
    );
  }

  let body: { bucket?: string; path?: string; contentType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { bucket, path, contentType } = body ?? {};

  if (bucket !== UPLOAD_BUCKET) {
    return NextResponse.json({ error: "Invalid bucket" }, { status: 400 });
  }

  if (!isValidApplicationUploadPath(path)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  // The path already had to end in an image extension; a declared content
  // type must agree that it's an image (not SVG).
  if (!isAcceptableUploadContentType(contentType)) {
    return NextResponse.json(
      { error: "Please choose an image file (JPG, PNG, or HEIC)" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase.storage
    .from(UPLOAD_BUCKET)
    .createSignedUploadUrl(path);

  if (error) {
    console.error("Supabase signed upload URL error:", error);
    return NextResponse.json(
      { error: `Storage error: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    signedUrl: data.signedUrl,
    token: data.token,
  });
}
