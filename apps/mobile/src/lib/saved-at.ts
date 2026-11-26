/** "09:05" for a copy saved today, "2026-11-18 17:20" for an older one. */
export function formatSavedAt(savedAt: number, now = Date.now()): string {
  const d = new Date(savedAt);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const sameDay = new Date(now).toDateString() === d.toDateString();
  if (sameDay) return `${hh}:${mm}`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${hh}:${mm}`;
}
