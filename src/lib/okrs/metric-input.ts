// Validation for the optional numeric metric on a key result.
//
// The database CHECK (okr_kr_metric_ck) is the real guard, but it comes back as
// a Postgres constraint string that means nothing to a ministry leader. This
// turns the same rule into a sentence, and normalises the three fields so they
// are always written together or always cleared together.

type MetricResult =
  | { metric_start: number | null; metric_target: number | null; metric_unit: string | null }
  | { error: string };

export function normaliseMetric(body: Record<string, unknown>): MetricResult {
  const hasStart = body.metric_start !== null && body.metric_start !== undefined && body.metric_start !== "";
  const hasTarget = body.metric_target !== null && body.metric_target !== undefined && body.metric_target !== "";

  if (!hasStart && !hasTarget) {
    return { metric_start: null, metric_target: null, metric_unit: null };
  }

  if (!hasStart || !hasTarget) {
    return { error: "A tracked key result needs both a starting figure and a target." };
  }

  const start = Number(body.metric_start);
  const target = Number(body.metric_target);

  if (!Number.isFinite(start) || !Number.isFinite(target)) {
    return { error: "The starting figure and target must both be numbers." };
  }
  if (start === target) {
    return { error: "The target has to differ from the starting figure." };
  }

  const unit = typeof body.metric_unit === "string" ? body.metric_unit.trim() : "";
  return { metric_start: start, metric_target: target, metric_unit: unit || null };
}
