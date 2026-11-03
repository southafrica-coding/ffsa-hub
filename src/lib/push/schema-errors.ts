// Migration 288 (device_push_tokens + notification_preferences.push_muted_kinds)
// is applied by hand, so the code ships before the table exists. These codes
// mean "that table / column isn't there yet": push is simply not switched on.
//
//   42P01     Postgres undefined_table
//   42703     Postgres undefined_column
//   PGRST205  PostgREST: table not in the schema cache
//   PGRST204  PostgREST: column not in the schema cache

const MISSING_CODES = new Set(["42P01", "42703", "PGRST205", "PGRST204"]);

export function isMissingSchema(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code === "string" && MISSING_CODES.has(code)) return true;
  return (
    typeof message === "string" &&
    /(device_push_tokens|push_muted_kinds)/.test(message) &&
    /(does not exist|schema cache)/.test(message)
  );
}
