// ============================================================
// Store — PDF upload rules (signed, direct-to-storage)
// ============================================================
// Why PDFs never pass through a route handler:
//
//   Vercel caps a serverless function's REQUEST BODY at 4.5 MB. A real
//   Year-End Review is ~20-25 MB (Jack's test draft is 21.9 MB), so a route
//   that buffers the file (FormData / req.arrayBuffer()) fails on Vercel
//   with 413 FUNCTION_PAYLOAD_TOO_LARGE, even if it works on localhost.
//
// So the flow is:
//   1. POST /api/store/admin/products/[id]/pdf   JSON {filename, contentType, size}
//      → validated here, returns a short-lived Supabase signed upload token
//        for the PRIVATE store-source bucket (no file body).
//   2. The browser PUTs the file straight to Supabase Storage.
//   3. POST /api/store/admin/assets/[id]/complete  (JSON, no body needed)
//      → checks the stored object's real size, then renders the pages in
//        the background (next/server `after()`).
//   4. The admin page polls GET /api/store/admin/assets/[id] for progress.
//
// Do NOT "simplify" this back to uploading through a route handler.
// ============================================================

/** Largest PDF the Store accepts. The store-source bucket enforces it too
 *  (migration 412, file_size_limit) so a hand-crafted PUT can't exceed it. */
export const MAX_PDF_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * How long a signed PDF upload stays usable, in seconds. Explicit, not the
 * Storage default: storage-js 2.7.1's createSignedUploadUrl takes no
 * expiresIn (Storage fixes its token at 2 hours), so the Hub enforces this
 * shorter window itself: /complete and /render refuse an asset still
 * awaiting_upload once SIGNED_UPLOAD_TTL_SECONDS have passed since it was
 * signed, and mark it failed. A late PUT can land a file, but it is never
 * rendered or made active. Upsert is always off, so a token can't
 * overwrite an object that already landed.
 */
export const SIGNED_UPLOAD_TTL_SECONDS = 30 * 60;

/** Is a signed upload issued at `signedAt` still inside its window? */
export function uploadWindowOpen(signedAt: string | null | undefined, now = Date.now()): boolean {
  const t = signedAt ? Date.parse(signedAt) : NaN;
  return Number.isFinite(t) && now - t <= SIGNED_UPLOAD_TTL_SECONDS * 1000;
}

/** What Vercel lets through a function body; documentation only. */
export const VERCEL_BODY_LIMIT_BYTES = 4.5 * 1024 * 1024;

export type PdfUploadRequest = { filename: string; contentType: string; size: number };

export function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Check the metadata the browser sends before it gets an upload URL. */
export function validatePdfUpload(
  body: unknown
): { ok: true; value: PdfUploadRequest } | { ok: false; error: string; status: 400 | 413 } {
  const b = (body ?? {}) as Record<string, unknown>;
  const filename = typeof b.filename === "string" ? b.filename.trim() : "";
  const contentType = typeof b.contentType === "string" ? b.contentType.trim().toLowerCase() : "";
  const size = typeof b.size === "number" ? b.size : NaN;

  if (!filename || filename.length > 200) return { ok: false, error: "Give the file a name (up to 200 characters).", status: 400 };
  if (!/\.pdf$/i.test(filename)) return { ok: false, error: "That isn't a PDF. The file name should end in .pdf.", status: 400 };
  if (contentType !== "application/pdf") return { ok: false, error: "That isn't a PDF.", status: 400 };
  if (!Number.isInteger(size) || size <= 0) return { ok: false, error: "That file is empty.", status: 400 };
  if (size > MAX_PDF_BYTES) {
    return { ok: false, error: `That PDF is ${formatMb(size)}. The limit is ${formatMb(MAX_PDF_BYTES)}; export it smaller and try again.`, status: 413 };
  }
  return { ok: true, value: { filename, contentType, size } };
}

/** Is the object that landed in Storage the one we signed for? */
export function checkStoredObject(
  stored: { size?: number | null } | null,
  declaredSize: number | null
): { ok: true } | { ok: false; error: string } {
  if (!stored || typeof stored.size !== "number") return { ok: false, error: "The PDF didn't finish uploading. Upload it again." };
  if (stored.size > MAX_PDF_BYTES) return { ok: false, error: `That PDF is over ${formatMb(MAX_PDF_BYTES)}.` };
  if (declaredSize != null && stored.size !== declaredSize) {
    return { ok: false, error: "The upload was cut short. Upload it again." };
  }
  return { ok: true };
}

/** A render that started this long ago and never finished was killed
 *  (function timeout); it may be claimed again. Matches maxDuration. */
export const RENDER_STALE_MS = 6 * 60 * 1000;

// ────────────────────────────────────────────────────────────
// Background music (optional, per product)
// ────────────────────────────────────────────────────────────
// Same signed, direct-to-storage flow as the PDF (a song can be bigger than
// Vercel's 4.5 MB body cap), into the PRIVATE store-audio bucket:
//   1. POST   /api/store/admin/products/[id]/audio  {filename, contentType, size}
//   2. the browser PUTs the file to Storage
//   3. PUT    /api/store/admin/products/[id]/audio  {path}  → checks it landed, saves audio_path
//   DELETE    /api/store/admin/products/[id]/audio          → no music
// Readers get it from GET /api/store/library/[productId]/audio, a
// short-lived signed URL, only with an entitlement and a registered device.

/** Largest music file. The store-audio bucket enforces it too (migration 412). */
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024; // 20 MB

/** How long a reader's signed music link lasts; the reader asks again when it fails. */
export const AUDIO_URL_TTL_SECONDS = 15 * 60;

/** Audio types we take, and the extension each is stored under (never the uploaded name). */
export const AUDIO_TYPES: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
};

/** The type Storage is told (its allowed list has no audio/mp3). */
export const storedAudioType = (contentType: string) => (contentType === "audio/mp3" ? "audio/mpeg" : contentType);

export type AudioUploadRequest = { filename: string; contentType: string; size: number; ext: string };

/** Check the metadata the browser sends before it gets a music upload URL. */
export function validateAudioUpload(
  body: unknown
): { ok: true; value: AudioUploadRequest } | { ok: false; error: string; status: 400 | 413 } {
  const b = (body ?? {}) as Record<string, unknown>;
  const filename = typeof b.filename === "string" ? b.filename.trim() : "";
  const contentType = typeof b.contentType === "string" ? b.contentType.trim().toLowerCase() : "";
  const size = typeof b.size === "number" ? b.size : NaN;
  if (!filename || filename.length > 200) return { ok: false, error: "Give the file a name (up to 200 characters).", status: 400 };
  const ext = AUDIO_TYPES[contentType];
  if (!ext) return { ok: false, error: "That isn't an audio file. Use MP3, M4A, WAV or OGG.", status: 400 };
  if (!Number.isInteger(size) || size <= 0) return { ok: false, error: "That file is empty.", status: 400 };
  if (size > MAX_AUDIO_BYTES) {
    return { ok: false, error: `That file is ${formatMb(size)}. The limit is ${formatMb(MAX_AUDIO_BYTES)}; export it smaller and try again.`, status: 413 };
  }
  return { ok: true, value: { filename, contentType, size, ext } };
}

/** An audio path this product may point at: `<product id>/<uuid>.<ext>`, as the start route makes them. */
export function isAudioPathFor(productId: string, path: unknown): path is string {
  if (typeof path !== "string") return false;
  const m = /^([0-9a-f-]{36})\/[0-9a-f-]{36}\.(mp3|m4a|aac|wav|ogg|oga|webm)$/.exec(path);
  return !!m && m[1] === productId;
}
