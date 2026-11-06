// Test data for the OKR screens, in the shape the server sends
// (src/lib/mobile/okrs.ts at the repo root).

import type { Checkin, KeyResult, Objective, OkrCycle, OwnerPage, OwnerSummary, Wall } from "../types";

export const OWNER_ID = "11111111-1111-4111-8111-111111111111";

export const CURRENT: OkrCycle = { id: "c26", name: "2026", slug: "2026", startsOn: "2026-01-01", endsOn: "2026-12-31", isCurrent: true };
export const PAST: OkrCycle = { id: "c25", name: "2025", slug: "2025", startsOn: "2025-01-01", endsOn: "2025-12-31", isCurrent: false };

const zero = { not_started: 0, in_progress: 0, moving_forward: 0, stuck: 0, complete: 0 };

export function owner(over: Partial<OwnerSummary> = {}): OwnerSummary {
  return {
    id: OWNER_ID,
    name: "DTS",
    kind: "ministry",
    retired: false,
    objectives: 2,
    keyResults: 5,
    byStatus: { ...zero, complete: 2, stuck: 1, in_progress: 2 },
    ...over,
  };
}

export function wall(over: Partial<Wall> = {}): Wall {
  return {
    cycles: [CURRENT, PAST],
    cycle: CURRENT,
    canManageCycles: false,
    seesGaps: false,
    totals: { groups: 3, groupsStarted: 2, objectives: 3, keyResults: 6, complete: 2, stuck: 1 },
    sections: [
      { type: "main", label: "Main ministries", total: 2, started: [owner()], notStarted: [] },
      {
        type: "part_time",
        label: "Part-time ministries",
        total: 1,
        started: [owner({ id: "m-choir", name: "Choir", objectives: 1, keyResults: 1, byStatus: { ...zero, moving_forward: 1 } })],
        notStarted: [],
      },
    ],
    showHeadings: true,
    ...over,
  };
}

export function keyResult(over: Partial<KeyResult> = {}): KeyResult {
  return {
    id: "kr1",
    label: "KR1",
    description: "Reach 180 people with the gospel",
    timeline: "Q4",
    notes: null,
    ownerNote: null,
    status: "moving_forward",
    currentValue: 90,
    metricUnit: "people",
    hasMetric: true,
    progressPct: 50,
    caption: "90 / 180 people",
    lastCheckinAt: null,
    ...over,
  };
}

export function objective(over: Partial<Objective> = {}): Objective {
  return {
    id: "o1",
    position: 1,
    title: "Grow the school",
    description: "Why it matters",
    timeline: null,
    notes: null,
    ownerNote: null,
    keyResults: [keyResult(), keyResult({ id: "kr2", label: null, description: "Launch a leadership track", status: "stuck", hasMetric: false, progressPct: null, caption: null, currentValue: null, metricUnit: null })],
    ...over,
  };
}

export function ownerPage(over: Partial<OwnerPage> = {}): OwnerPage {
  return {
    owner: { id: OWNER_ID, name: "DTS", kind: "ministry" },
    cycles: [CURRENT, PAST],
    cycle: CURRENT,
    canEdit: false,
    readOnly: "read_access",
    totals: { objectives: 1, keyResults: 2, complete: 0, stuck: 1 },
    objectives: [objective()],
    ...over,
  };
}

export function checkin(over: Partial<Checkin> = {}): Checkin {
  return {
    id: "ch1",
    checkin_on: "2026-10-01",
    status: "moving_forward",
    value: 90,
    comment: "Halfway there",
    author_name: "Ann Lee",
    created_at: "2026-10-01T10:00:00Z",
    ...over,
  };
}
