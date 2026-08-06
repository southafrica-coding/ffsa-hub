// Shared day-first date formatting for user-facing display. Input is an ISO
// date (YYYY-MM-DD, or an ISO timestamp); output is DD/MM/YYYY. Anything that
// doesn't parse as a date is returned unchanged so callers can pass raw values
// safely.
export function formatDateDMY(value: string | null | undefined): string {
  if (!value) return "";
  const m = String(value).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(value);
  return `${m[3]}/${m[2]}/${m[1]}`;
}
