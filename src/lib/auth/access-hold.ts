// HUB access holds (migration 317).
//
// An account with a user_access_holds row can't use the HUB until its
// opens_on date (SAST). Used for Gap Year students, who get access a month
// before their school starts. Pure helpers here so the middleware (edge) and
// the tests share one definition of "still held".

/** Today as YYYY-MM-DD in South Africa (UTC+2, no DST). */
export function todaySast(now: Date = new Date()): string {
  return new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** True while the hold's date hasn't arrived. A missing/garbled date never holds. */
export function isAccessHeld(
  opensOn: string | null | undefined,
  today: string = todaySast()
): boolean {
  if (!opensOn || !/^\d{4}-\d{2}-\d{2}$/.test(opensOn)) return false;
  return opensOn > today;
}

/** "15 January 2027". */
export function formatOpensOn(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export const ACCESS_NOT_OPEN_CODE = "not_open";
