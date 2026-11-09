import { createAdminClient } from "@/lib/supabase/admin";
import { LMS_SUBMISSIONS_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/schools/lms-assignments";

// Storage for the private lms-submissions bucket (migration 310).
//
// The service-role client is used ONLY here, and every caller must first
// read the lms_submission_files row (or create it) through the signed-in
// user's client, so RLS has already decided the caller may touch that
// exact path. A path is never taken from the request body.

function bucket() {
  return createAdminClient().storage.from(LMS_SUBMISSIONS_BUCKET);
}

/** Short-lived (≤5 min) download URL for one object. */
export async function signDownload(path: string, fileName: string): Promise<{ url: string | null; error: string | null }> {
  const { data, error } = await bucket().createSignedUrl(path, SIGNED_URL_TTL_SECONDS, { download: fileName });
  return { url: data?.signedUrl ?? null, error: error?.message ?? null };
}

/** One-shot signed upload for a path the user's client just registered. */
export async function signUpload(
  path: string
): Promise<{ data: { signedUrl: string; token: string; path: string } | null; error: string | null }> {
  const { data, error } = await bucket().createSignedUploadUrl(path);
  if (error || !data) return { data: null, error: error?.message ?? "Could not create upload URL" };
  return { data: { signedUrl: data.signedUrl, token: data.token, path: data.path }, error: null };
}

/** Which of these paths (all in one folder) have an object. */
export async function existingObjects(folder: string): Promise<Set<string>> {
  const { data } = await bucket().list(folder, { limit: 100 });
  return new Set((data ?? []).map((o) => `${folder}/${o.name}`));
}

/** Best-effort removal after the row is already gone. */
export async function removeObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await bucket().remove(paths);
}
