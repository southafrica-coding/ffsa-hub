/**
 * "Updated from Xero {time}" — how current the Hub's copy of each Xero file
 * is (migration 275 xero_sync_runs). Client-safe: no server imports.
 */

export type XeroMirrorRegion = "za" | "us";

export type XeroMirrorFreshness = {
  region: XeroMirrorRegion;
  /** finished_at of the last run that read Xero (succeeded or partial). */
  lastUpdatedAt: string | null;
  lastRun: { status: string; started_at: string; finished_at: string | null; error: string | null } | null;
};

export function formatXeroTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Johannesburg",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shorten(text: string, max = 160) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * One plain line per org. A disconnected org says so and still points at the
 * last copy; nothing here asks anyone to sync by hand.
 */
export function describeXeroFreshness(
  f: XeroMirrorFreshness | undefined
): { tone: "good" | "warn" | "quiet" | "bad"; text: string } {
  const last = f?.lastUpdatedAt ? formatXeroTime(f.lastUpdatedAt) : null;
  const shown = last ? `Showing the copy last updated from Xero ${last}.` : "Nothing has been read from Xero yet.";
  const run = f?.lastRun;
  if (!run) return { tone: "quiet", text: "Not read from Xero yet." };
  switch (run.status) {
    case "running":
      return { tone: "quiet", text: last ? `Updated from Xero ${last}. Checking for changes now.` : "Reading from Xero now." };
    case "skipped":
      return { tone: "warn", text: `Not connected to Xero. ${shown}` };
    case "failed":
      return {
        tone: "bad",
        text: `Xero could not be read at ${formatXeroTime(run.started_at)}${run.error ? ` (${shorten(run.error)})` : ""}. ${shown}`,
      };
    case "partial":
      return {
        tone: "warn",
        text: `Updated from Xero ${last ?? formatXeroTime(run.started_at)}. ${run.error ? shorten(run.error) : "Some rows could not be updated."}`,
      };
    default:
      return { tone: "good", text: last ? `Updated from Xero ${last}` : "Updated from Xero" };
  }
}
