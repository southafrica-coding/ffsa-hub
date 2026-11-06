import { describe, expect, it } from "vitest";
import { STATUS_ESTIMATE, buildOrgModel, krPct, meanPct, pctLabel, rollUpState, updateMonthStart, type OrgInput, type RawKr } from "./model";
import { computeLayout, litSet, teamRows, teamTableRows } from "./layout";

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

  it("measures a KR from its metric, and otherwise estimates from its status", () => {
    expect(media.objectives[0].krs[0]).toMatchObject({ pct: 50, measured: true });
    // stuck, no metric → the status stand-in, flagged as an estimate
    expect(media.objectives[0].krs[1]).toMatchObject({ pct: STATUS_ESTIMATE.stuck, measured: false });
    expect(media.objectives[0].state).toBe("stuck");
  });

  it("makes an objective's bar the share of its key results that are complete", () => {
    expect(media.objectives[0]).toMatchObject({ pct: 0, complete: 0 });
    const done = buildOrgModel(
      input({
        objectives: [
          { id: "o2", staff_ministry_id: "media", title: "x", description: null, direction: null, position: 1,
            krs: [kr({ current_status: "complete" }), kr({ current_status: "complete" }), kr({ current_status: "moving_forward" }), kr()] },
        ],
      })
    ).teams.find((t) => t.id === "media")!.objectives[0];
    expect(done).toMatchObject({ pct: 50, complete: 2 });
    const empty = buildOrgModel(
      input({ objectives: [{ id: "o3", staff_ministry_id: "media", title: "y", description: null, direction: null, position: 1, krs: [] }] })
    ).teams.find((t) => t.id === "media")!.objectives[0];
    expect(empty.pct).toBeNull();
  });

  it("labels estimates with a ~ and measurements plainly", () => {
    expect(pctLabel(86)).toBe("86%");
    expect(pctLabel(50, false)).toBe("~50%");
    expect(krPct({ metric_start: null, metric_target: null, current_value: null, metric_unit: null, current_status: "complete" })).toEqual({ pct: 100, measured: false });
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

  it("works out OKR lines for objectives with a direction (the canvas shows them only on selection)", () => {
    const okr = l.edges.filter((e) => e.kind === "okr");
    expect(okr).toHaveLength(1);
    expect(okr[0]).toMatchObject({ a: "dir:mission", b: "team:media", state: "stuck" });
  });

  it("reserves the direction column under the left-hand tables, so nothing shifts when it appears", () => {
    expect(l.pos.dir).toBeDefined();
    expect(l.pos.dir.y).toBeGreaterThan(l.pos.lt.y + l.pos.lt.h);
  });

  it("sizes a team's table by its people, not its objectives", () => {
    const media = m.teams.find((t) => t.id === "media")!;
    // 1 lead row (Tosca) + 0 others + the "+N more · OPEN" row
    expect(teamTableRows(media)).toMatchObject({ more: 0 });
    expect(teamRows(media)).toBe(2);
    const events = m.teams.find((t) => t.id === "events")!;
    // no lead ("Not named yet") + 2 people + OPEN row
    expect(teamRows(events)).toBe(4);
    const rca = m.teams.find((t) => t.id === "rca")!;
    // "within Training" + no lead + OPEN row
    expect(teamRows(rca)).toBe(3);
  });

  it("names the whole roster, leads first", () => {
    const big = buildOrgModel(
      input({
        members: Array.from({ length: 9 }, (_, i) => ({
          id: "b" + i, staff_ministry_id: "media", user_id: "u" + i, member_role: i === 0 ? "leader" : "member",
          is_point_leader: i === 0, role_title: null, responsibilities: [], share_pct: null, staff_kind: null, subcategories: [],
        })),
        people: Array.from({ length: 9 }, (_, i) => ({ id: "u" + i, name: "Person " + i, job_title: null })),
      })
    ).teams.find((t) => t.id === "media")!;
    const r = teamTableRows(big);
    expect(r.leads).toHaveLength(1);
    expect(r.shown).toHaveLength(8);
    expect(r.more).toBe(0);
    expect(r.leads.length + r.shown.length).toBe(big.members.length);
  });

  it("places every Leadership ministry and every Alongside ministry", () => {
    const placed = computeLayout(
      buildOrgModel(
        input({
          teams: [
            { id: "lt", name: "Leadership Team", slug: "leadership_team", cluster: "leadership", parent_id: null, purpose: null, description: null, ministry_type: "main", sort_order: 1 },
            { id: "board", name: "Board", slug: "board", cluster: "leadership", parent_id: null, purpose: null, description: null, ministry_type: "main", sort_order: 2 },
            { id: "missio", name: "Missio", slug: "missio", cluster: "alongside", parent_id: null, purpose: null, description: null, ministry_type: "main", sort_order: 3 },
            { id: "chapel", name: "Chapel", slug: "chapel", cluster: "alongside", parent_id: null, purpose: null, description: null, ministry_type: "main", sort_order: 4 },
          ],
        })
      )
    );
    for (const id of ["lt", "board", "missio", "chapel"]) expect(placed.pos[id]).toBeDefined();
    expect(placed.pos.board.x).toBe(placed.pos.lt.x);
    expect(placed.pos.chapel.x).toBe(placed.pos.missio.x);
    expect(placed.pos.board.y).toBeGreaterThan(placed.pos.lt.y);
    expect(placed.pos.chapel.y).toBeGreaterThan(placed.pos.missio.y);
  });

  it("draws a reporting line to someone who is not on the Leadership team", () => {
    const m2 = buildOrgModel(
      input({
        lines: [
          { staff_ministry_id: "media", leader_user_id: "mache", kind: "oversees", label: null },
        ],
      })
    );
    const laid = computeLayout(m2);
    expect(laid.edges.some((e) => e.kind === "report" && e.a === "person:mache" && e.b === "team:media")).toBe(true);
    expect(laid.outside.some((p) => p.userId === "mache")).toBe(false);
  });

  it("gives a row to a reporting line whose person is on no roster", () => {
    const m2 = buildOrgModel(
      input({
        lines: [{ staff_ministry_id: "media", leader_user_id: "ghost", kind: "oversees", label: null }],
        people: [
          { id: "caleb", name: "Caleb", job_title: null },
          { id: "tosca", name: "Tosca Ferndale", job_title: "Media lead" },
          { id: "mache", name: "Maché van Zyl", job_title: "Hosting" },
          { id: "ghost", name: "Ghost Lead", job_title: null },
        ],
      })
    );
    const laid = computeLayout(m2);
    expect(laid.outside.map((p) => p.userId)).toEqual(["ghost"]);
    expect(laid.pos.outside).toBeDefined();
    expect(laid.edges.some((e) => e.kind === "report" && e.a === "lead:ghost" && e.b === "team:media")).toBe(true);
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
