/**
 * The same preview lock as the schools LMS routes: Vercel sets VERCEL_ENV
 * to "preview" on preview URLs. Production and local dev are not blocked.
 * Reads are not affected. This draft does not set the variable.
 */
export function xeroPreviewWriteBlock(): { error: "preview_writes_disabled"; message: string } | null {
  if (process.env.VERCEL_ENV === "preview") {
    return {
      error: "preview_writes_disabled",
      message: "This preview deployment cannot write to Xero.",
    };
  }
  return null;
}
