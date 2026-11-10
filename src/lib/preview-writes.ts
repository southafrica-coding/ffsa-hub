/**
 * Preview deployments on Vercel share the production database.
 * Anything that emails a real person, or stamps a reminder time that
 * person would see, has to stop when this is true.
 *
 * VERCEL_ENV=preview is the platform signal. PREVIEW_WRITES_DISABLED
 * is the same switch for a host that is not Vercel.
 */
export function previewWritesDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.PREVIEW_WRITES_DISABLED;
  if (flag === "1" || flag === "true") return true;
  return env.VERCEL_ENV === "preview";
}

/**
 * Same refusal #536 uses for school writes on a preview deployment:
 * 403 and the error code `preview_writes_disabled`. Null when writes are allowed.
 */
export function previewWriteRefusal(env: NodeJS.ProcessEnv = process.env): {
  status: 403;
  body: { error: "preview_writes_disabled"; message: string };
} | null {
  if (!previewWritesDisabled(env)) return null;
  return {
    status: 403,
    body: {
      error: "preview_writes_disabled",
      message: "This preview deployment cannot change school records.",
    },
  };
}
