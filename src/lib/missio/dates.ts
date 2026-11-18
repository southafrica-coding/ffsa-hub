/**
 * UTC calendar date. This is Postgres `current_date` when TimeZone is UTC,
 * which is how Supabase runs. started_at and ended_at use this value.
 * Do not compute them in SAST. The SA civil date is a day ahead of
 * current_date between 00:00 and 02:00 SAST, so a SAST date would not
 * match the trigger.
 */
export function todayIsoDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** ended_at for DELETE. Always the UTC database date, never a future date. */
export function endDateFor(now = new Date()): string {
  return todayIsoDate(now);
}

/** True when the ISO date is after the UTC database date. */
export function isAfterDatabaseToday(isoDate: string, today = todayIsoDate()): boolean {
  return isoDate.slice(0, 10) > today;
}
