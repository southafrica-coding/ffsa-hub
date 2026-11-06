// The evangelism tables and the private media bucket are proposed for Hub
// Data. Until they exist, PostgREST and Storage fail in a way the routes
// turn into 503 evangelism_not_enabled — the same idea as push (migration
// 288) shipping before its table.

const MISSING_CODES = new Set(["42P01", "42703", "PGRST205", "PGRST204"]);

export function isEvangelismNotReady(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message, error: nested } = error as {
    code?: unknown;
    message?: unknown;
    error?: unknown;
  };
  if (typeof code === "string" && MISSING_CODES.has(code)) return true;
  const text = typeof message === "string" ? message : typeof nested === "string" ? nested : "";
  if (!text) return false;
  return (
    /evangelism_testimonies|evangelism_media|evangelism_removals|evangelism-media/i.test(text) &&
    /does not exist|schema cache|not found|Bucket not found/i.test(text)
  ) || /Bucket not found/i.test(text);
}
