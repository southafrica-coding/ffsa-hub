// ────────────────────────────────────────────────────────────
// Application photo upload paths
// ────────────────────────────────────────────────────────────
// /api/upload/sign hands out signed upload URLs to ANONYMOUS applicants on
// /apply, so the path it will sign is the main thing standing between it and
// "write any file anywhere in the bucket". The form builds the path here and
// the route validates it here, so the two can't drift:
//
//   applications/<application-or-program-id>/<question-id>/<uuid>-<name>.<ext>
//
// The uuid is fresh per upload, so a signed URL can only ever create a new
// object; it can't be aimed at an existing applicant's photo.
// Shared by a 'use client' component and a route handler: keep it pure.
// ────────────────────────────────────────────────────────────

export const UPLOAD_BUCKET = "application-uploads";
export const MAX_UPLOAD_PATH_LENGTH = 255;

const EXTENSION_FOR_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/pjpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/avif": "avif",
};

export const ALLOWED_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "avif"];

const SAFE_ID = "[A-Za-z0-9_-]{1,64}";
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const UPLOAD_PATH = new RegExp(
  `^applications/${SAFE_ID}/${SAFE_ID}/${UUID}-[A-Za-z0-9_-]{0,64}\\.(${ALLOWED_IMAGE_EXTENSIONS.join("|")})$`,
  "i"
);

/** True only for the exact path shape the application form produces. */
export function isValidApplicationUploadPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length <= MAX_UPLOAD_PATH_LENGTH &&
    UPLOAD_PATH.test(path)
  );
}

/**
 * The content type the form declares, if any, must be an image we accept.
 * An empty one is allowed: some phones send none (the extension already had
 * to pass). SVG is refused: it can carry script.
 */
export function isAcceptableUploadContentType(contentType: unknown): boolean {
  if (contentType === undefined || contentType === null || contentType === "") return true;
  if (typeof contentType !== "string") return false;
  return contentType.toLowerCase() in EXTENSION_FOR_TYPE;
}

/**
 * The path the form uploads to. The extension comes from the detected image
 * type rather than the user's file name, so "scan.jfif" or "IMG_0042" still
 * produce a path the route accepts.
 */
export function buildApplicationUploadPath(input: {
  applicationId: string;
  questionId: string;
  uuid: string;
  fileName: string;
  contentType: string;
}): string {
  const dot = input.fileName.lastIndexOf(".");
  const base = (dot > 0 ? input.fileName.slice(0, dot) : input.fileName)
    .replace(/[^A-Za-z0-9-]/g, "_")
    .slice(0, 50);
  const fromName = dot > 0 ? input.fileName.slice(dot + 1).toLowerCase() : "";
  const ext =
    EXTENSION_FOR_TYPE[input.contentType.toLowerCase()] ??
    (ALLOWED_IMAGE_EXTENSIONS.includes(fromName) ? fromName : "jpg");
  return `applications/${input.applicationId}/${input.questionId}/${input.uuid}-${base}.${ext}`;
}
