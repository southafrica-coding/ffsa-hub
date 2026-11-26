import { describe, expect, it } from "vitest";
import {
  l10Pages,
  l10Paths,
  mapFieldErrors,
  normalizeTeamDetail,
  weekValueConflictResult,
  WEEK_VALUE_EXISTS_COPY,
} from "./api";

describe("L10 API paths (#741)", () => {
  const paths = l10Paths("operations");
  const pages = l10Pages("operations");

  it("keeps page URLs at /departments/[slug]/l10/[teamId] and API under /l10/teams/", () => {
    expect(pages.teams).toBe("/departments/operations/l10");
    expect(pages.team("team-host")).toBe("/departments/operations/l10/team-host");
    expect(paths.teams).toBe("/api/departments/operations/l10");
    expect(paths.team("team-host")).toBe("/api/departments/operations/l10/teams/team-host");
    expect(paths.measurableValues("team-host")).toBe(
      "/api/departments/operations/l10/teams/team-host/measurable_values"
    );
    expect(paths.end("team-host", "m1")).toBe(
      "/api/departments/operations/l10/teams/team-host/meetings/m1/end"
    );
  });

  it("maps a duplicate scorecard week 409 to fixed copy and hides server text", () => {
    const result = weekValueConflictResult();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("conflict");
    expect(result.fieldErrors.week_start).toBe(WEEK_VALUE_EXISTS_COPY);
    expect(WEEK_VALUE_EXISTS_COPY).toBe("That week already has a number.");
    expect(mapFieldErrors({ fieldErrors: { week_start: "That already exists" }, error: "That already exists" })).toEqual({
      week_start: "Pick a Monday.",
    });
    expect(JSON.stringify(result.fieldErrors)).not.toContain("That already exists");
  });

  it("normalises a #741 team payload, including live_meeting and measurable_values", () => {
    const detail = normalizeTeamDetail({
      team: { id: "t1", slug: "host", name: "Host", recap_source_team_id: "t2" },
      members: [{ profile_id: "u1", role: "leader", user: { first_name: "Alex", last_name: "More" } }],
      rocks: [],
      measurables: [],
      measurable_values: [{ measurable_id: "m1", week_start: "2026-11-23", value: 3 }],
      todos: [],
      issues: [],
      live_meeting: {
        meeting: { id: "meet-1", started_at: "2026-11-26T08:00:00.000Z", segment_timings: {}, current_segment: "segue" },
        attendees: [],
        headlines: [],
      },
    });
    expect(detail.measurable_values).toHaveLength(1);
    expect(detail.live_meeting?.meeting.id).toBe("meet-1");
    expect(detail.live_meeting?.meeting.current_segment).toBe("segue");
    expect(detail.members[0]?.name).toBe("Alex More");
  });
});
