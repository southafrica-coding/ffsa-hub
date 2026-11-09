import { NextResponse } from "next/server";

// Small HTTP helpers for the schools LMS routes. previewWritesDisabled is
// ported from #501's src/lib/schools/lms-http.ts (only this helper and
// json / NO_STORE; nothing else from that PR).

export const NO_STORE = { "Cache-Control": "no-store" };

export function json(body: unknown, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/**
 * Preview deployments must not write live school rows. Vercel sets
 * VERCEL_ENV to "preview" on preview URLs; production and local dev
 * (unset) keep writing. Reads are not affected.
 *
 * Previews share the prod database and the lms-submissions bucket, and a
 * submitted attempt or a frozen grade cannot be deleted afterwards, so a
 * test write from a preview would be permanent.
 */
export function previewWritesDisabled() {
  if (process.env.VERCEL_ENV === "preview") {
    return json(
      {
        error: "preview_writes_disabled",
        message: "This preview deployment cannot change school records.",
      },
      403
    );
  }
  return null;
}
