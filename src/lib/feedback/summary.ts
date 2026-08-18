// Aggregation for the feedback results screen.
//
// The point of a debrief is the pattern, not the individual reply: one
// person saying comms were poor is an opinion, eleven saying it is a
// fact about the next event. So every closed question is reduced to an
// average plus a distribution, and every open question is collected as
// a list to read.

import {
  allFields,
  fieldRange,
  isChoiceType,
  isNumericType,
  type FeedbackField,
  type FeedbackSchema,
} from "./schema";

export type ResponseRow = {
  id: string;
  respondent_name: string | null;
  respondent_email: string | null;
  answers: Record<string, unknown>;
  submitted_at: string;
};

export type NumericSummary = {
  kind: "numeric";
  field: FeedbackField;
  count: number;
  average: number | null;
  min: number;
  max: number;
  /** One bucket per possible value, so empty buckets still draw. */
  distribution: { value: number; count: number }[];
  /** Only meaningful for NPS questions. */
  nps: number | null;
};

export type ChoiceSummary = {
  kind: "choice";
  field: FeedbackField;
  count: number;
  counts: { option: string; count: number }[];
};

export type TextSummary = {
  kind: "text";
  field: FeedbackField;
  count: number;
  answers: { responseId: string; name: string | null; text: string }[];
};

export type FieldSummary = NumericSummary | ChoiceSummary | TextSummary;

function answerValues(rows: ResponseRow[], fieldId: string): unknown[] {
  return rows
    .map((r) => r.answers?.[fieldId])
    .filter((v) => v !== null && v !== undefined && v !== "");
}

function summariseNumeric(field: FeedbackField, rows: ResponseRow[]): NumericSummary {
  const { min, max } = fieldRange(field);
  const nums = answerValues(rows, field.id)
    .map((v) => Number(v))
    .filter((n) => !Number.isNaN(n));

  const buckets = new Map<number, number>();
  for (let v = min; v <= max; v++) buckets.set(v, 0);
  for (const n of nums) buckets.set(n, (buckets.get(n) ?? 0) + 1);

  // NPS convention: 9–10 promoters, 0–6 detractors, 7–8 passive.
  let nps: number | null = null;
  if (field.type === "nps" && nums.length) {
    const promoters = nums.filter((n) => n >= 9).length;
    const detractors = nums.filter((n) => n <= 6).length;
    nps = Math.round(((promoters - detractors) / nums.length) * 100);
  }

  return {
    kind: "numeric",
    field,
    count: nums.length,
    average: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null,
    min,
    max,
    distribution: [...buckets.entries()].map(([value, count]) => ({ value, count })),
    nps,
  };
}

function summariseChoice(field: FeedbackField, rows: ResponseRow[]): ChoiceSummary {
  const options =
    field.type === "yes_no" ? ["Yes", "No"] : (field.options ?? []);
  const counts = new Map<string, number>();
  for (const o of options) counts.set(o, 0);

  let count = 0;
  for (const v of answerValues(rows, field.id)) {
    const picked = Array.isArray(v) ? v : [v];
    if (picked.length) count += 1;
    for (const p of picked) {
      // Booleans reach here from yes/no questions submitted by older clients.
      const key = typeof p === "boolean" ? (p ? "Yes" : "No") : String(p);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return {
    kind: "choice",
    field,
    count,
    counts: [...counts.entries()]
      .map(([option, c]) => ({ option, count: c }))
      .sort((a, b) => b.count - a.count),
  };
}

function summariseText(field: FeedbackField, rows: ResponseRow[]): TextSummary {
  const answers = rows
    .map((r) => ({
      responseId: r.id,
      name: r.respondent_name,
      text: String(r.answers?.[field.id] ?? "").trim(),
    }))
    .filter((a) => a.text !== "");
  return { kind: "text", field, count: answers.length, answers };
}

export function summariseFeedback(
  schema: FeedbackSchema,
  rows: ResponseRow[]
): FieldSummary[] {
  return allFields(schema).map((field) => {
    if (isNumericType(field.type)) return summariseNumeric(field, rows);
    if (isChoiceType(field.type) || field.type === "yes_no")
      return summariseChoice(field, rows);
    return summariseText(field, rows);
  });
}

/**
 * The event's headline number: the mean of every rating/scale question,
 * each normalised to a percentage of its own range so a 1–5 star and a
 * 0–10 scale carry equal weight. Null when nothing numeric was asked.
 */
export function overallScore(summaries: FieldSummary[]): number | null {
  const scored = summaries.filter(
    (s): s is NumericSummary =>
      s.kind === "numeric" && s.average !== null && s.count > 0
  );
  if (!scored.length) return null;
  const pcts = scored.map(
    (s) => ((s.average! - s.min) / Math.max(s.max - s.min, 1)) * 100
  );
  return Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
}

/** CSV of every response, one row per submission. */
export function responsesToCsv(
  schema: FeedbackSchema,
  rows: ResponseRow[],
  anonymous: boolean
): string {
  const fields = allFields(schema);
  const header = [
    "Submitted at",
    ...(anonymous ? [] : ["Name", "Email"]),
    ...fields.map((f) => f.label || "(untitled question)"),
  ];

  const cell = (v: unknown): string => {
    const s = Array.isArray(v)
      ? v.join("; ")
      : v === null || v === undefined
        ? ""
        : typeof v === "boolean"
          ? v
            ? "Yes"
            : "No"
          : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };

  const lines = rows.map((r) =>
    [
      cell(new Date(r.submitted_at).toISOString()),
      ...(anonymous ? [] : [cell(r.respondent_name), cell(r.respondent_email)]),
      ...fields.map((f) => cell(r.answers?.[f.id])),
    ].join(",")
  );

  return [header.map(cell).join(","), ...lines].join("\n");
}
