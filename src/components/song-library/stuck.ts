import { SONG_STAGES, type SongLibrarySongStatus, type SongStage } from "./types";

/**
 * Days without progress before a song in a stage counts as stuck. Null =
 * never stuck. Default 14; Set it down asks for about a day away from the
 * song, so 7; Celebrate is the end of the road and is never stuck.
 * P&W leads can change these (song_library_stage_settings); the API sends
 * the live values and these are the fallback.
 */
export const DEFAULT_STUCK_AFTER: Record<SongStage, number | null> = {
  idea_entry: 14,
  writing: 14,
  set_down: 7,
  refine: 14,
  written_needs_demo: 14,
  demo_ready: 14,
  share: 14,
  celebrate: null,
};

/**
 * Event kinds that count as progress: a stage change, a new version, a
 * placement or checkpoint change, a pathway step, or a refine tick.
 */
export type ProgressKind = "stage" | "version" | "placement" | "checkpoint" | "pathway_step" | "refine_tick";

const DAY_MS = 86_400_000;

/** Whole days between the last progress and now (never negative). */
export function stuckDays(lastProgressAt: string | Date, now: Date): number {
  const last = typeof lastProgressAt === "string" ? new Date(lastProgressAt) : lastProgressAt;
  const ms = now.getTime() - last.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.floor(ms / DAY_MS);
}

/** The latest progress instant: the song's creation or any progress event. */
export function lastProgress(createdAt: string, progress: readonly { at: string }[]): string {
  let latest = createdAt;
  for (const event of progress) if (new Date(event.at) > new Date(latest)) latest = event.at;
  return latest;
}

export function isStuck(
  stage: SongStage,
  days: number,
  thresholds: Record<SongStage, number | null> = DEFAULT_STUCK_AFTER
): boolean {
  const after = thresholds[stage];
  if (after == null) return false;
  return days >= after;
}

export interface StuckInfo {
  days: number;
  stuck: boolean;
}

/** Prefer the server's status view; work it out from last_activity_at if absent. */
export function stuckInfo(
  stage: SongStage,
  lastActivityAt: string,
  now: Date,
  status?: Pick<SongLibrarySongStatus, "stuck_days" | "is_stuck"> | null
): StuckInfo {
  if (status) return { days: status.stuck_days, stuck: status.is_stuck };
  const days = stuckDays(lastActivityAt, now);
  return { days, stuck: isStuck(stage, days) };
}

/** Board order: stuck first (longest first), then most recent activity. */
export function sortForBoard<T extends { stuck: boolean; days: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.stuck !== b.stuck) return a.stuck ? -1 : 1;
    return a.stuck ? b.days - a.days : a.days - b.days;
  });
}

/** Stages that should show the red dot on the board switcher. */
export function stagesWithStuck(rows: readonly { stage: SongStage; stuck: boolean }[]): Set<SongStage> {
  const out = new Set<SongStage>();
  for (const row of rows) if (row.stuck) out.add(row.stage);
  return out;
}

export function stageCounts(rows: readonly { stage: SongStage }[]): Record<SongStage, number> {
  const counts = Object.fromEntries(SONG_STAGES.map((s) => [s, 0])) as Record<SongStage, number>;
  for (const row of rows) counts[row.stage] += 1;
  return counts;
}
