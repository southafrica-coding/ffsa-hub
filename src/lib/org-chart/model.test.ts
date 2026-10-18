import { describe, expect, it } from "vitest";
import { buildOrgModel, meanPct, rollUpState, updateMonthStart, type OrgInput, type RawKr } from "./model";
import { computeLayout, litSet } from "./layout";

const kr = (over: Partial<RawKr> = {}): RawKr => ({
  id: Math.random().toString(36).slice(2),
  description: "A key result",
  position: 0,
  current_status: "not_started",
  current_value: null,
  metric_start: null,
  metric_target: null,
  metric_unit: null,
  owner_user_id: null,
  owner_note: null,
  last_checkin_at: null,
  ...over,
});

function input(over: Partial<OrgInput> = {}): OrgInput {
  return {
    teams: [
      { id: "lt", name: "Leadership Team", slug: "leadership_team", cluster: "leadership", parent_id: null, purpose: null, description: null, ministry_type: "main", sort_order: 1 },
      { id: "media", name: "Media", slug: "media", cluster: "backbone", parent_id: null, purpose: "Tell the story", description: null, ministry_type: "main", sort_order: 2 },
      { id: "events", name: "Events", slug: "events", cluster: "outward", parent_id: null, purpose: null, description: null, ministry_type: "main", sort_order: 3 },
      { id: "tr", name: "Training", slug: "training", cluster: "inward", parent_id: null, purpose: null, description: null, ministry_type: "main", sort_order: 4 },
      { id: "rca", name: "RCA", slug: "rca", cluster: "inward", parent_id: "tr", purpose: null, description: null, ministry_type: "main", sort_order: 5 },
      { id: "hope", name: "Hope Again", slug: "hope_again", cluster: null, parent_id: null, purpose: null, description: null, ministry_type: "part_time", sort_order: 6 },
      { id: "none", name: "No Ministry", slug: "no_ministry", cluster: null, parent_id: null, purpose: null, description: null, ministry_type: "main", sort_order: 7 },
    ],
    members: [
      { id: "m1", staff_ministry_id: "lt", user_id: "caleb", member_role: "member", is_point_leader: false, role_title: "Integrator", responsibilities: [], share_pct: null, staff_kind: null, subcategories: [] },
      { id: "m2", staff_ministry_id: "media", user_id: "tosca", member_role: "leader", is_point_leader: true, role_title: null, responsibilities: ["Runs the team"], share_pct: null, staff_kind: null, subcategories: [] },
      { id: "m3", staff_ministry_id: "events", user_id: "tosca", member_role: "member", is_point_leader: false, role_title: "Events media", responsibilities: [], share_pct: null, staff_kind: null, subcategories: [] },
      { id: "m4", staff_ministry_id: "events", user_id: "mache", member_role: "member", is_point_leader: false, role_title: null, responsibilities: [], share_pct: null, staff_kind: null, subcategories: ["Hosting"] },
      { id: "m5", staff_ministry_id: "none", user_id: "x", member_role: "member", is_point_leader: false, role_title: null, responsibilities: [], share_pct: null, staff_kind: null, subcategories: [] },
    ],
    people: [
      { id: "caleb", name: "Caleb", job_title: null },
      { id: "tosca", name: "Tosca Ferndale", job_title: "Media lead" },
      { id: "mache", name: "Maché van Zyl", job_title: "Hosting" },
    ],
    lines: [
      { staff_ministry_id: "media", leader_user_id: "caleb", kind: "oversees", label: null },
      { staff_ministry_id: "lt", leader_user_id: "caleb", kind: "integrates", label: "Integrator" },
    ],
    objectives: [
      {
        id: "o1",
        staff_ministry_id: "media",
        title: "Media that disciples",
        description: null,
        direction: "mission",
        position: 1,
        krs: [
          kr({ current_status: "moving_forward", metric_start: 0, metric_target: 10, current_value: 5, last_checkin_at: "2026-09-29T10:00:00Z" }),
          kr({ current_status: "stuck", owner_user_id: "tosca" }),
        ],
      },
    ],
    shepherds: [{ staff_ministry_id: "media", user_id: "tosca" }],
    schools: [{ id: "ffx", name: "FFX", students: 38 }],
    cycleName: "2026",
    updateMonthStart: "2026-09-01",
    ...over,
  };
}

describe("rollUpState", () => {
  it("lets stuck win, and needs every state complete for complete", () => {
    expect(rollUpState(["moving", "stuck", "complete"])).toBe("stuck");
    expect(rollUpState(["complete", "complete"])).toBe("complete");
    expect(rollUpState(["complete", "notstarted"])).toBe("moving");
    expect(rollUpState(["progress", "notstarted"])).toBe("progress");
    expect(rollUpState([])).toBe("notstarted");
  });
});

describe("meanPct — no ratio, no bar", () => {
  it("averages only the percentages that exist", () => {
    expect(meanPct([50, null, 100])).toBe(75);
    expect(meanPct([null, null])).toBeNull();
  });
});

describe("buildOrgModel", () => {
  const m = buildOrgModel(input());
  const media = m.teams.find((t) => t.id === "media")!;

  it("never draws the No Ministry placeholder", () => {
    expect(m.teams.some((t) => t.id === "none")).toBe(false);
  });

  it("reads progress only from real metrics", () => {
    expect(media.objectives[0].krs[0].pct).toBe(50);
    expect(media.objectives[0].krs[1].pct).toBeNull();
    expect(media.objectives[0].pct).toBe(50);
    expect(media.objectives[0].state).toBe("stuck");
  });

  it("counts an update as in when a check-in falls in the update month or later", () => {
    expect(media.updated).toBe(true);
    const later = buildOrgModel(input({ updateMonthStart: "2026-10-01" }));
    expect(later.teams.find((t) => t.id === "media")!.updated).toBe(false);
    expect(m.updateMonthLabel).toBe("SEP");
  });

  it("names leads, shepherd, and KR owners from the people they point at", () => {
    expect(media.leads).toEqual(["Tosca Ferndale"]);
    expect(media.shepherd).toBe("Tosca Ferndale");
    expect(media.objectives[0].krs[1].ownerName).toBe("Tosca Ferndale");
    expect(media.lines).toEqual([{ userId: "caleb", name: "Caleb", kind: "oversees", label: null }]);
  });

  it("works out shared people from two memberships, never from a stored line", () => {
    expect(m.shared).toEqual([{ a: "events", b: "media", people: ["Tosca Ferndale"] }]);
    expect(media.members[0].alsoOn).toEqual(["events"]);
  });

  it("groups a roster by its sub-categories, with the rest as Team", () => {
    const events = m.teams.find((t) => t.id === "events")!;
    expect(events.groups.map((g) => g.name)).toEqual(["Hosting", "Team"]);
    expect(events.headcount).toBe(2);
  });

  it("tags the Integrator on the Leadership team", () => {
    expect(m.leaders).toEqual([{ userId: "caleb", name: "Caleb", tag: "INTEGRATOR", title: "Integrator" }]);
  });

  it("rolls objectives up to their direction", () => {
    const mission = m.directions.find((d) => d.key === "mission")!;
    expect(mission.feeders).toEqual([{ teamId: "media", objectiveId: "o1" }]);
    expect(mission.state).toBe("stuck");
    expect(m.directions.find((d) => d.key === "presence")!.pct).toBeNull();
  });

  it("puts part-time ministries in their own zone and children under their parent", () => {
    expect(m.teams.find((t) => t.id === "hope")!.cluster).toBe("parttime");
    expect(m.teams.find((t) => t.id === "rca")!.parentId).toBe("tr");
  });
});

describe("computeLayout", () => {
  const m = buildOrgModel(input());
  const l = computeLayout(m);

  it("places every team, and the child straight after its parent", () => {
    for (const t of m.teams) expect(l.pos[t.id]).toBeDefined();
    expect(l.pos.rca.y).toBe(l.pos.tr.y);
    expect(l.pos.rca.x).toBeGreaterThan(l.pos.tr.x);
    expect(l.pos.schools).toBeDefined();
  });

  it("draws an OKR line only for an objective with a direction", () => {
    expect(l.edges.filter((e) => e.kind === "okr")).toHaveLength(1);
  });

  it("draws a reporting line from a Leadership-team row, and a dotted line for a shared person", () => {
    expect(l.edges.some((e) => e.kind === "report" && e.a === "lead:caleb" && e.b === "team:media")).toBe(true);
    expect(l.edges.some((e) => e.kind === "works" && e.a === "team:events" && e.b === "team:media")).toBe(true);
  });

  it("lets a saved position override the automatic one", () => {
    const moved = computeLayout(m, { media: { x: 900, y: 40 } });
    expect(moved.pos.media).toMatchObject({ x: 900, y: 40 });
  });

  it("lights what is connected to the selection", () => {
    const lit = litSet("team:media", l.edges);
    expect(lit.has("lead:caleb")).toBe(true);
    expect(lit.has("team:events")).toBe(true);
    expect(lit.has("team:tr")).toBe(false);
  });
});

describe("updateMonthStart", () => {
  it("is last month, by the clock in South Africa", () => {
    expect(updateMonthStart(new Date("2026-10-18T10:00:00Z"))).toBe("2026-09-01");
    // 23:30 UTC on 31 Oct is already 1 Nov in Potchefstroom.
    expect(updateMonthStart(new Date("2026-10-31T23:30:00Z"))).toBe("2026-10-01");
    expect(updateMonthStart(new Date("2027-01-05T10:00:00Z"))).toBe("2026-12-01");
  });
});
