import { describe, expect, it } from "vitest";
import {
  discussionOrder,
  recapHeadlines,
  recapSourceName,
  visibleHeadlines,
  formatHm,
  goalLabel,
  idsGroups,
  initials,
  measureStatus,
  nextL10Date,
  nextMeetingStart,
  rankChanges,
  reportWeek,
  scoreRows,
} from "./derive";
import type { L10Issue, L10Measurable, L10Rock, L10Todo } from "./types";

const TEAM = { meeting_weekday: 2, meeting_time: "09:00:00", meeting_timezone: "Africa/Johannesburg" };
// Tue 1 Dec 2026, 08:30 SAST.
const TUE_0830 = Date.UTC(2026, 11, 1, 6, 30);

function measurable(extra: Partial<L10Measurable>): L10Measurable {
  return {
    id: "m1",
    title: "Sets covered",
    owner_id: null,
    unit: "number",
    goal_value: 10,
    goal_direction: "at_least",
    sort_order: 0,
    is_active: true,
    ...extra,
  };
}

function issue(id: string, extra: Partial<L10Issue> = {}): L10Issue {
  return {
    id,
    title: id,
    description: null,
    owner_id: null,
    status: "identified",
    priority: null,
    solved_at: null,
    source_meeting_id: null,
    resolved_meeting_id: null,
    created_at: "2026-11-20T08:00:00Z",
    ...extra,
  };
}

describe("names", () => {
  it("makes initials from first and last names", () => {
    expect(initials("Amy Jo Adams")).toBe("AA");
    expect(initials("ben")).toBe("B");
    expect(initials(null)).toBe("?");
  });
});

describe("meeting times", () => {
  it("finds the next start in SA time, rolling past ones to next week", () => {
    const next = nextMeetingStart(TEAM, TUE_0830);
    expect(next).toBe(Date.UTC(2026, 11, 1, 7, 0));
    expect(formatHm(next ?? 0)).toBe("09:00");
    expect(nextMeetingStart(TEAM, Date.UTC(2026, 11, 1, 7, 1))).toBe(Date.UTC(2026, 11, 8, 7, 0));
    expect(nextMeetingStart({ ...TEAM, meeting_time: null }, TUE_0830)).toBeNull();
  });

  it("defaults a new to-do to the next L10 day after today", () => {
    expect(nextL10Date(TEAM, TUE_0830)).toBe("2026-12-08");
    expect(nextL10Date({ ...TEAM, meeting_weekday: 4 }, TUE_0830)).toBe("2026-12-03");
    expect(nextL10Date({ ...TEAM, meeting_weekday: null }, TUE_0830)).toBe("2026-12-08");
  });

  it("reports on last week's Monday", () => {
    expect(reportWeek(TUE_0830)).toBe("2026-11-23");
  });
});

describe("scorecard", () => {
  it("rates numbers and yes/no against the goal, and spots unmarked rows", () => {
    const sets = measurable({});
    expect(measureStatus(sets, 12)).toBe("on");
    expect(measureStatus(sets, 9)).toBe("off");
    expect(measureStatus(sets, null)).toBe("not_marked");
    expect(measureStatus(measurable({ goal_direction: "at_most", goal_value: 2 }), 3)).toBe("off");
    const yes = measurable({ unit: "yes_no", goal_value: 1, goal_direction: "exactly" });
    expect(measureStatus(yes, 0)).toBe("off");
    expect(goalLabel(yes)).toBe("Yes");
    expect(goalLabel(sets)).toBe("≥ 10");
  });

  it("builds four weeks of trend, report week last", () => {
    const rows = scoreRows(
      [measurable({})],
      [
        { measurable_id: "m1", week_start: "2026-11-23", value: 8 },
        { measurable_id: "m1", week_start: "2026-11-09", value: 11 },
      ],
      "2026-11-23"
    );
    expect(rows[0]?.trend).toEqual([null, 11, null, 8]);
    expect(rows[0]?.status).toBe("off");
  });
});

describe("IDS", () => {
  const rock: L10Rock = { id: "r1", title: "New rota", owner_user_id: null, status: "off_track", due_on: null, quarter: "2026-Q4" };
  const carried: L10Todo = {
    id: "t1",
    title: "Fix the mic",
    owner_id: null,
    due_on: null,
    done: false,
    done_at: null,
    source_meeting_id: null,
    created_at: "2026-11-20T08:00:00Z",
  };

  it("groups ranked, off-track rock, carried to-do and other issues", () => {
    const groups = idsGroups({
      meetingId: "m",
      meetingStartedAt: "2026-12-01T07:00:00Z",
      issues: [
        issue("b", { priority: 2 }),
        issue("a", { priority: 1 }),
        issue("new rota"),
        issue("talk"),
        issue("old", { status: "solved", solved_at: "x", resolved_meeting_id: "other" }),
        issue("done here", { status: "solved", solved_at: "x", resolved_meeting_id: "m" }),
      ],
      rocks: [rock],
      todos: [carried],
    });
    expect(groups.urgent.map((r) => r.kind === "issue" && r.issue.id)).toEqual(["a", "b"]);
    expect(groups.offTrackRocks.map((r) => r.kind)).toEqual(["issue"]);
    expect(groups.incompleteTodos.map((r) => r.kind)).toEqual(["todo"]);
    expect(groups.talk.map((r) => r.kind === "issue" && r.issue.id)).toEqual(["talk", "done here"]);
    expect(discussionOrder(groups).map((i) => i.id)).toEqual(["a", "b", "new rota", "talk"]);
  });

  it("moves a rank off whoever held it", () => {
    const issues = [issue("a", { priority: 1 }), issue("b")];
    expect(rankChanges(issues, "b", 1)).toEqual([
      { id: "a", priority: null },
      { id: "b", priority: 1 },
    ]);
    expect(rankChanges(issues, "a", null)).toEqual([{ id: "a", priority: null }]);
  });
});


describe("auto headlines", () => {
  it("names the paired team and hides dismissed rows", () => {
    const production = { id: "prod", name: "Production" };
    const live = { id: "live", name: "Live", recap_source_team_id: "prod" };
    expect(
      recapSourceName({ is_auto: true, recap_source_team_name: "Production" }, live, [production, live])
    ).toBe("Production");
    expect(recapSourceName({ is_auto: true }, live, [production, live])).toBe("Production");
    const rows = [
      { id: "a", body: "Recap", author_id: null, source_meeting_id: null, created_at: "2026-11-26T08:00:00.000Z", is_auto: true, recap_of_meeting_id: "m1", dismissed_at: null },
      { id: "b", body: "Old", author_id: null, source_meeting_id: null, created_at: "2026-11-26T07:00:00.000Z", is_auto: true, recap_of_meeting_id: "m0", dismissed_at: "2026-11-26T10:00:00.000Z" },
    ];
    expect(visibleHeadlines(rows).map((h) => h.id)).toEqual(["a"]);
    expect(recapHeadlines(rows).map((h) => h.id)).toEqual(["a"]);
    expect(recapHeadlines(rows.filter((h) => h.id === "b")).map((h) => h.id)).toEqual(["b"]);
  });
});
