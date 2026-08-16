// Numeral formatting shared by the events list and the event detail KPI
// strip. Lifted out of the list page so both screens group thousands the
// same way — two copies would drift.

/** 2000 → "2 000". Thin grouping, per the design's numeral treatment. */
export function groupDigits(n: number) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/**
 * Headcount as a percentage of capacity, for <Bar pct>. Clamped to
 * 0–100 (an oversold event fills the bar rather than overflowing it)
 * and null when there is no capacity to be a ratio of — no denominator,
 * no bar.
 */
export function capacityPct(count: number, capacity: number | null) {
  if (!capacity || capacity <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((count / capacity) * 100)));
}
