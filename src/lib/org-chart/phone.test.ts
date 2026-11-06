import { describe, expect, it } from "vitest";
import { buildOrgModel, type OrgInput } from "@/lib/org-chart/model";
import { phoneAttention } from "@/lib/org-chart/phone";

function model(over: Partial<OrgInput> = {}) {
  const input: OrgInput = {
    teams: [
      { id: "lt", name: "Leadership", slug: "leadership", cluster: "leadership", parent_id: null, purpose: null, description: null, ministry_type: "main", sort_order: 1 },
      { id: "media", name: "Media", slug: "media", cluster: "backbone", parent_id: null, purpose: null, description: null, ministry_type: "main", sort_order: 2 },
    ],
    members: [
      { id: "m1", staff_ministry_id: "lt", user_id: "a", member_role: "leader", is_point_leader: true, role_title: null, responsibilities: [], share_pct: null, staff_kind: null, subcategories: [] },
      { id: "m2", staff_ministry_id: "media", user_id: "b", member_role: "member", is_point_leader: false, role_title: null, responsibilities: [], share_pct: null, staff_kind: null, subcategories: [] },
    ],
    people: [
      { id: "a", name: "Ada", job_title: null },
      { id: "b", name: "Bo", job_title: null },
    ],
    lines: [],
    objectives: [],
    shepherds: [],
    schools: [],
    cycleName: "2026",
    updateMonthStart: "2026-09-01",
    ...over,
  };
  return buildOrgModel(input);
}

describe("phoneAttention", () => {
  it("names a team that has people and no lead", () => {
    const band = phoneAttention(model());
    expect(band?.n).toBe("1");
    expect(band?.text).toMatch(/nobody named as lead/);
  });

  it("prefers a stuck key result over a missing lead", () => {
    const band = phoneAttention(
      model({
        objectives: [
          {
            id: "o1",
            staff_ministry_id: "media",
            title: "Ship it",
            description: null,
            direction: "mission",
            position: 1,
            krs: [
              {
                id: "k1",
                description: "Film the story",
                position: 0,
                current_status: "stuck",
                current_value: null,
                metric_start: null,
                metric_target: null,
                metric_unit: null,
                owner_user_id: null,
                owner_note: null,
                last_checkin_at: null,
              },
            ],
          },
        ],
      })
    );
    expect(band?.n).toBe("1");
    expect(band?.text).toMatch(/stuck/);
  });

  it("stays quiet when nothing is waiting", () => {
    const quiet = model({
      members: [
        { id: "m1", staff_ministry_id: "lt", user_id: "a", member_role: "leader", is_point_leader: true, role_title: null, responsibilities: [], share_pct: null, staff_kind: null, subcategories: [] },
        { id: "m2", staff_ministry_id: "media", user_id: "b", member_role: "leader", is_point_leader: true, role_title: null, responsibilities: [], share_pct: null, staff_kind: null, subcategories: [] },
      ],
    });
    expect(phoneAttention(quiet)).toBeNull();
  });
});
