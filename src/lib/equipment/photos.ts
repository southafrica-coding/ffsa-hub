// Product photos live in the public equipment-photos bucket (migration 255),
// so the store can link straight to them.

export const PHOTO_BUCKET = "equipment-photos";

const PHOTO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Same ceiling the add-photo route already uses. */
export const LISTING_PHOTO_MAX_BYTES = 8 * 1024 * 1024;

/** Null when the file is a JPG, PNG, or WEBP within the size limit. */
export function listingPhotoProblem(file: { type: string; size: number }): string | null {
  if (!PHOTO_EXT[file.type]) return "Photos must be JPG, PNG or WEBP";
  if (file.size > LISTING_PHOTO_MAX_BYTES) return "Photos must be 8 MB or smaller";
  return null;
}

export function listingPhotoExtension(type: string): string | null {
  return PHOTO_EXT[type] ?? null;
}

/** A new object key. Replace writes a new file and deletes the old one. */
export function newListingPhotoPath(productId: string, ext: string): string {
  return `${productId}/${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`;
}

export type ListingPhotoUpload = {
  file: File;
  ext: string;
  /** Set only when the form included an alt field. */
  alt?: string | null;
};

/** The multipart body both add and replace accept. */
export async function readListingPhotoUpload(
  request: Request
): Promise<ListingPhotoUpload | { error: string; status: number }> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { error: "Expected multipart form data", status: 400 };
  }
  const file = form.get("file");
  if (!(file instanceof File)) return { error: "No file provided", status: 400 };
  const problem = listingPhotoProblem(file);
  if (problem) return { error: problem, status: 400 };
  const ext = listingPhotoExtension(file.type);
  if (!ext) return { error: "Photos must be JPG, PNG or WEBP", status: 400 };
  const upload: ListingPhotoUpload = { file, ext };
  const altField = form.get("alt");
  if (typeof altField === "string") upload.alt = altField.trim() || null;
  return upload;
}

export function photoUrl(filePath: string): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  return `${base}/storage/v1/object/public/${PHOTO_BUCKET}/${filePath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}
