import { describe, expect, it } from "vitest";

import { buildOwnerPage, buildWall, pickCycle, toMobileKeyResult } from "./okrs";
import type { OkrCycle, OkrKeyResult, OkrObjective } from "@/types/okrs";

const CURRENT: OkrCycle = {
  id: "c26",
  name: "2026",
  slug: "2026",
  starts_on: "2026-01-01",
  ends_on: "2026-12-31",
  is_current: true,
};
const PAST: OkrCycle = { ...CURRENT, id: "c25", name: "2025", slug: "2025", is_current: false };

function kr(over: Partial<OkrKeyResult> = {}): OkrKeyResult {
  return {
    id: "kr1",
    objective_id: "o1",
    position: 1,
    label: null,
    description: "Launch a leadership track",
    notes: null,
    timeline: null,
    owner_note: null,
    metric_unit: null,
    metric_start: null,
    metric_target: null,
    current_status: "in_progress",
    current_value: null,
    last_checkin_at: null,
    ...over,
  };
}

function objective(id: string, ministryId: string | null, krs: OkrKeyResult[]): OkrObjective {
  return {
    id,
    cycle_id: "c26",
    scope: "ministry",
    staff_ministry_id: ministryId,
    okr_team_id: null,
    subcategory_id: null,
    owner_user_id: null,
    position: 1,
    title: `Objective ${id}`,
    description: null,
    notes: null,
    owner_note: null,
    timeline: null,
    is_archived: false,
    okr_key_results: krs,
  };
}

const MINISTRIES = [
  { id: "m-dts", name: "DTS", slug: "dts", is_active: true, ministry_type: "main" },
  { id: "m-worship", name: "Worship", slug: "worship", is_active: true, ministry_type: "main" },
  { id: "m-choir", name: "Choir", slug: "choir", is_active: true, ministry_type: "part_time" },
  { id: "m-none", name: "No Ministry", slug: "no_ministry", is_active: true, ministry_type: "main" },
  { id: "m-old", name: "Old Outreach", slug: "old", is_active: false, ministry_type: "main" },
  { id: "m-gone", name: "Gone", slug: "gone", is_active: false, ministry_type: "main" },
];

describe("pickCycle", () => {
  it("prefers the requested slug, then current, then newest", () => {
    expect(pickCycle([CURRENT, PAST], "2025")?.id).toBe("c25");
    expect(pickCycle([CURRENT, PAST], "nope")?.id).toBe("c26");
    expect(pickCycle([CURRENT, PAST], null)?.id).toBe("c26");
    expect(pickCycle([PAST], undefined)?.id).toBe("c25");
    expect(pickCycle([], "2026")).toBeNull();
  });
});

describe("buildWall", () => {
  const objectives = [
    objective("o1", "m-dts", [kr({ id: "a", current_status: "complete" }), kr({ id: "b", current_status: "stuck" })]),
    objective("o2", "m-choir", [kr({ id: "c" })]),
    objective("o3", "m-old", [kr({ id: "d", current_status: "complete" })]),
  ];

  it("totals, Main / Part-time sections and retired groups, like the web wall", () => {
    const wall = buildWall({
      cycles: [CURRENT, PAST],
      cycle: CURRENT,
      objectives,
      ministries: MINISTRIES,
      seesGaps: false,
      canManageCycles: false,
    });
    expect(wall.cycle).toMatchObject({ slug: "2026", isCurrent: true, startsOn: "2026-01-01" });
    expect(wall.cycles.map((c) => c.slug)).toEqual(["2026", "2025"]);
    // DTS, Worship, Choir and Old Outreach (has objectives); not No Ministry, not Gone.
    expect(wall.totals).toEqual({ groups: 4, groupsStarted: 3, objectives: 3, keyResults: 4, complete: 2, stuck: 1 });
    expect(wall.showHeadings).toBe(true);
    expect(wall.sections.map((s) => [s.type, s.label, s.total])).toEqual([
      ["main", "Main ministries", 3],
      ["part_time", "Part-time ministries", 1],
    ]);
    const main = wall.sections[0];
    expect(main.started.map((o) => o.name)).toEqual(["DTS", "Old Outreach"]);
    expect(main.started[1].retired).toBe(true);
    expect(main.started[0].byStatus).toMatchObject({ complete: 1, stuck: 1 });
    // Not a leader / admin / leadership: no gap list.
    expect(main.notStarted).toEqual([]);
  });

  it("shows the not-started list to people who can act on it, on the current cycle only", () => {
    const wall = buildWall({ cycles: [CURRENT], cycle: CURRENT, objectives, ministries: MINISTRIES, seesGaps: true, canManageCycles: true });
    expect(wall.sections[0].notStarted.map((o) => o.name)).toEqual(["Worship"]);
    expect(wall.canManageCycles).toBe(true);
    expect(wall.seesGaps).toBe(true);

    const closed = buildWall({ cycles: [PAST], cycle: PAST, objectives, ministries: MINISTRIES, seesGaps: true, canManageCycles: false });
    expect(closed.sections.every((s) => s.notStarted.length === 0)).toBe(true);
  });

  it("drops empty sections and headings when only one kind is left", () => {
    const wall = buildWall({
      cycles: [CURRENT],
      cycle: CURRENT,
      objectives: [objective("o1", "m-dts", [])],
      ministries: MINISTRIES,
      seesGaps: false,
      canManageCycles: false,
    });
    expect(wall.sections.map((s) => s.type)).toEqual(["main"]);
    expect(wall.showHeadings).toBe(false);
  });
});

describe("toMobileKeyResult", () => {
  it("prose key results get no bar", () => {
    expect(toMobileKeyResult(kr())).toMatchObject({ hasMetric: false, progressPct: null, caption: null });
  });

  it("tracked key results carry the web's ratio and caption", () => {
    const out = toMobileKeyResult(
      kr({ metric_start: 0, metric_target: 180, current_value: 120, metric_unit: "people", last_checkin_at: "2026-10-01T10:00:00Z" })
    );
    expect(out).toMatchObject({ hasMetric: true, progressPct: 67, caption: "120 / 180 people", currentValue: 120 });
  });

  it("a metric with no check-in yet is tracked but has no bar", () => {
    expect(toMobileKeyResult(kr({ metric_start: 40, metric_target: 10 }))).toMatchObject({ hasMetric: true, progressPct: null });
  });
});

describe("buildOwnerPage", () => {
  const base = {
    owner: { id: "m-dts", name: "DTS", kind: "ministry" as const },
    cycles: [CURRENT, PAST],
    objectives: [objective("o1", "m-dts", [kr({ current_status: "complete" }), kr({ id: "kr2", current_status: "stuck" })])],
  };

  it("leaders can check in on the current cycle", () => {
    const page = buildOwnerPage({ ...base, cycle: CURRENT, canEditOwner: true });
    expect(page.canEdit).toBe(true);
    expect(page.readOnly).toBeNull();
    expect(page.totals).toEqual({ objectives: 1, keyResults: 2, complete: 1, stuck: 1 });
    expect(page.objectives[0].keyResults).toHaveLength(2);
  });

  it("closed cycles are always read-only, even for leaders", () => {
    const page = buildOwnerPage({ ...base, cycle: PAST, canEditOwner: true });
    expect(page.canEdit).toBe(false);
    expect(page.readOnly).toBe("closed");
  });

  it("everyone else reads", () => {
    const page = buildOwnerPage({ ...base, cycle: CURRENT, canEditOwner: false });
    expect(page.canEdit).toBe(false);
    expect(page.readOnly).toBe("read_access");
  });
});
