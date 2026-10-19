// Product photos live in the public equipment-photos bucket (migration 255),
// so the store can link straight to them.

export const PHOTO_BUCKET = "equipment-photos";

export function photoUrl(filePath: string): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  return `${base}/storage/v1/object/public/${PHOTO_BUCKET}/${filePath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}
