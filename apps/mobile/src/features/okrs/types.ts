// Response shapes for the OKR screens, parsed tolerantly (unknown fields are
// ignored, optional ones may be null or missing) so the server can grow
// without breaking installed apps. The server contract is
// src/lib/mobile/okrs.ts at the repo root.

import { z } from "zod";

export const OKR_STATUSES = ["not_started", "in_progress", "moving_forward", "stuck", "complete"] as const;
export type OkrStatus = (typeof OKR_STATUSES)[number];

const statusSchema = z.enum(OKR_STATUSES);
const str = z.string().nullish().transform((v) => v ?? null);
const num = z.number().nullish().transform((v) => v ?? null);
const count = z.number().int().nonnegative().catch(0);

export const cycleSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  startsOn: z.string(),
  endsOn: z.string(),
  isCurrent: z.boolean().catch(false),
});
export type OkrCycle = z.infer<typeof cycleSchema>;

const byStatusSchema = z.object({
  not_started: count,
  in_progress: count,
  moving_forward: count,
  stuck: count,
  complete: count,
});
export type StatusCounts = z.infer<typeof byStatusSchema>;

export const ownerSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["ministry", "team"]).catch("ministry"),
  retired: z.boolean().catch(false),
  objectives: count,
  keyResults: count,
  byStatus: byStatusSchema,
});
export type OwnerSummary = z.infer<typeof ownerSummarySchema>;

export const wallSchema = z.object({
  cycles: z.array(cycleSchema),
  cycle: cycleSchema.nullable(),
  canManageCycles: z.boolean().catch(false),
  seesGaps: z.boolean().catch(false),
  totals: z.object({
    groups: count,
    groupsStarted: count,
    objectives: count,
    keyResults: count,
    complete: count,
    stuck: count,
  }),
  sections: z.array(
    z.object({
      type: z.string(),
      label: z.string(),
      total: count,
      started: z.array(ownerSummarySchema),
      notStarted: z.array(ownerSummarySchema),
    }),
  ),
  showHeadings: z.boolean().catch(false),
});
export type Wall = z.infer<typeof wallSchema>;

export const keyResultSchema = z.object({
  id: z.string(),
  label: str,
  description: z.string(),
  timeline: str,
  notes: str,
  ownerNote: str,
  status: statusSchema.catch("not_started"),
  currentValue: num,
  metricUnit: str,
  hasMetric: z.boolean().catch(false),
  progressPct: num,
  caption: str,
  lastCheckinAt: str,
});
export type KeyResult = z.infer<typeof keyResultSchema>;

export const objectiveSchema = z.object({
  id: z.string(),
  position: z.number().catch(0),
  title: z.string(),
  description: str,
  timeline: str,
  notes: str,
  ownerNote: str,
  keyResults: z.array(keyResultSchema),
});
export type Objective = z.infer<typeof objectiveSchema>;

export const ownerPageSchema = z.object({
  owner: z.object({ id: z.string(), name: z.string(), kind: z.enum(["ministry", "team"]).catch("ministry") }),
  cycles: z.array(cycleSchema),
  cycle: cycleSchema,
  canEdit: z.boolean().catch(false),
  readOnly: z.enum(["closed", "read_access"]).nullable().catch("read_access"),
  totals: z.object({ objectives: count, keyResults: count, complete: count, stuck: count }),
  objectives: z.array(objectiveSchema),
});
export type OwnerPage = z.infer<typeof ownerPageSchema>;

// GET /api/okrs/key-results/[id]/checkins (the website's existing route).
export const checkinSchema = z.object({
  id: z.string(),
  checkin_on: z.string(),
  status: statusSchema.catch("not_started"),
  value: num,
  comment: str,
  author_name: str,
  created_at: str,
});
export type Checkin = z.infer<typeof checkinSchema>;

export const checkinsResponseSchema = z.object({ checkins: z.array(z.unknown()) }).transform((r) =>
  // One odd row shouldn't hide the rest.
  r.checkins.flatMap((c) => {
    const p = checkinSchema.safeParse(c);
    return p.success ? [p.data] : [];
  }),
);
