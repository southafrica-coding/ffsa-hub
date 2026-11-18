/**
 * The calendar date Postgres `current_date` uses when TimeZone is UTC,
 * which is how Supabase runs. guard_house_church_member compares ended_at
 * with that date.
 *
 * Africa/Johannesburg is UTC+2 and does not observe daylight saving.
 * Between 00:00 and 02:00 SAST the SA civil date is already the next day,
 * so a SAST "today" would disagree with the trigger. Comparisons and
 * stored start/end dates use this UTC date instead.
 */
export function todayIsoDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** True when the ISO date is after the UTC database date. */
export function isAfterDatabaseToday(isoDate: string, today = todayIsoDate()): boolean {
  return isoDate.slice(0, 10) > today;
}
