import type { StoredReading } from "./reading";

/**
 * The reader's summary and "things to watch", as a block for a document's
 * notes. Marked as coming from the scan so nobody mistakes it for a
 * person's judgment. null when there is nothing to add.
 */
export function formatReadingNotes(reading: StoredReading, fileName: string | null): string | null {
  const lines: string[] = [];
  if (reading.summary) lines.push(reading.summary.trim());
  for (const t of reading.things_to_watch ?? []) lines.push(`- ${t.trim()}`);
  if (lines.length === 0) return null;
  return [`Read from the scan${fileName ? ` "${fileName}"` : ""} by Claude — check against the paper:`, ...lines].join("\n");
}
