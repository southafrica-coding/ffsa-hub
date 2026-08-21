// The one place the OKR progress rules live.
//
// The house design rule is "no ratio, no bar": a progress bar may only appear
// where a real ratio exists. Most FFSA key results are prose ("Launch a
// leadership track"), not numbers, so most rows get no bar at all — and a 0%
// track is a lie, not a placeholder. krProgress() returns null for those and
// callers render nothing.

import type { Tone } from "@/components/ffsa";
import type { OkrKeyResult, OkrStatus } from "@/types/okrs";

export const STATUS_LABELS: Record<OkrStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  moving_forward: "Moving forward",
  stuck: "Stuck",
  complete: "Complete",
};

/**
 * `warn` (amber) is deliberately unused: it means "attention needed", and
 * letting it sit beside `stuck` would leave two colours competing to be the
 * one you look at first.
 */
const STATUS_TONES: Record<OkrStatus, Tone> = {
  not_started: "quiet",
  in_progress: "quiet",
  moving_forward: "good",
  stuck: "bad",
  complete: "good",
};

export function statusTone(status: OkrStatus): Tone {
  return STATUS_TONES[status] ?? "quiet";
}

export function statusLabel(status: OkrStatus): string {
  return STATUS_LABELS[status] ?? status;
}

type MetricFields = Pick<
  OkrKeyResult,
  "metric_start" | "metric_target" | "current_value" | "metric_unit"
>;

/**
 * The ratio for a key result, or null when it has no real metric.
 *
 * Null whenever start, target or the current value is missing — the database
 * CHECK (okr_kr_metric_ck) already guarantees start and target are set
 * together and differ, so the subtraction below cannot divide by zero, but the
 * current value only arrives with the first check-in.
 *
 * Subtracting the start handles counting-down targets too ("cut no-shows from
 * 40 to 10"): there, target < start, and both differences go negative, so the
 * ratio still runs 0 → 100 in the direction of progress.
 */
export function krProgress(kr: MetricFields): { pct: number; tone: string } | null {
  const { metric_start: start, metric_target: target, current_value: current } = kr;
  if (start === null || start === undefined) return null;
  if (target === null || target === undefined) return null;
  if (current === null || current === undefined) return null;
  if (target === start) return null;

  const raw = ((current - start) / (target - start)) * 100;
  const pct = Math.min(100, Math.max(0, raw));

  return { pct, tone: pct >= 100 ? "var(--yellow)" : "#0A0A0A" };
}

/** "120 / 180 people" for the row's caption, or null when there is no metric. */
export function metricCaption(kr: MetricFields): string | null {
  if (krProgress(kr) === null) return null;
  const unit = kr.metric_unit ? ` ${kr.metric_unit}` : "";
  return `${kr.current_value} / ${kr.metric_target}${unit}`;
}

/** Empty status tally, so callers can accumulate without pre-seeding keys. */
export function emptyStatusCounts(): Record<OkrStatus, number> {
  return {
    not_started: 0,
    in_progress: 0,
    moving_forward: 0,
    stuck: 0,
    complete: 0,
  };
}
