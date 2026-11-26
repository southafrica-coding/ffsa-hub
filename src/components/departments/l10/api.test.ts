import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copyForCode,
  copyFromErrorBody,
  createL10Api,
  l10Pages,
  l10Paths,
  mapFieldErrors,
  normalizeMeetingDetail,
  normalizeTeamDetail,
  readErrorCode,
  weekValueConflictResult,
  WEEK_VALUE_EXISTS_COPY,
  L10_AUTO_HEADLINE_LOCKED,
  L10_MEETING_ALREADY_OPEN,
} from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
    expect(paths.headlineDismiss("team-host", "h1")).toBe(
      "/api/departments/operations/l10/teams/team-host/headlines/h1/dismiss"
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

  it("normalises a #741 team payload, including running_meeting and measurable_values", () => {
    const detail = normalizeTeamDetail({
      team: { id: "t1", slug: "host", name: "Host", recap_source_team_id: "t2" },
      members: [{ profile_id: "u1", role: "leader", user: { first_name: "Alex", last_name: "More" } }],
      rocks: [],
      measurables: [],
      measurable_values: [{ measurable_id: "m1", week_start: "2026-11-23", value: 3 }],
      todos: [],
      issues: [],
      running_meeting: {
        meeting: { id: "meet-1", started_at: "2026-11-26T08:00:00.000Z", segment_timings: {}, current_segment: "segue" },
        attendees: [],
        headlines: [
          {
            id: "auto-1",
            body: "Recap of Setup",
            author_id: null,
            source_meeting_id: "meet-1",
            is_auto: true,
            recap_of_meeting_id: "meet-setup",
            dismissed_at: null,
          },
        ],
      },
    });
    expect(detail.measurable_values).toHaveLength(1);
    expect(detail.running_meeting?.meeting.id).toBe("meet-1");
    expect(detail.running_meeting?.meeting.current_segment).toBe("segue");
    expect(detail.headlines[0]?.is_auto).toBe(true);
    expect(detail.members[0]?.name).toBe("Alex More");
  });

  it("normalises a meeting payload that includes headlines and auto_headline", () => {
    const detail = normalizeMeetingDetail({
      meeting: { id: "meet-1", started_at: "2026-11-26T08:00:00.000Z", segment_timings: {}, current_segment: "headlines" },
      attendees: [],
      average_rating: null,
      auto_headline: "inserted",
      headlines: [{ id: "h1", body: "Recap", author_id: null, is_auto: true, recap_of_meeting_id: "m0", dismissed_at: null }],
    });
    expect(detail.auto_headline).toBe("inserted");
    expect(detail.headlines).toHaveLength(1);
    expect(detail.headlines[0]?.is_auto).toBe(true);
    expect(detail.meeting.current_segment).toBe("headlines");
  });
});

describe("L10 error code mapping", () => {
  const leak = "LEAKED SERVER TEXT that must never be shown";

  it("reads only the code field and never the error text", () => {
    expect(readErrorCode({ error: leak, code: L10_MEETING_ALREADY_OPEN })).toBe(L10_MEETING_ALREADY_OPEN);
    expect(readErrorCode({ error: leak })).toBeNull();
    expect(readErrorCode({ error: L10_MEETING_ALREADY_OPEN })).toBeNull();
    expect(readErrorCode("l10_meeting_already_open")).toBeNull();
    expect(readErrorCode(null)).toBeNull();
  });

  it("maps known codes to our copy and ignores the server's error string", () => {
    const body = { error: leak, code: L10_MEETING_ALREADY_OPEN, meeting_id: "meet-open" };
    expect(copyFromErrorBody(body)).toBe("This team already has a meeting running.");
    expect(copyFromErrorBody(body)).not.toContain(leak);
    expect(copyForCode(L10_AUTO_HEADLINE_LOCKED)).toBe(
      "This headline can't be edited or deleted. Dismiss it instead."
    );
    expect(copyFromErrorBody({ error: leak, code: L10_AUTO_HEADLINE_LOCKED })).not.toBe(leak);
    expect(copyFromErrorBody({ error: leak })).toBeNull();
    expect(copyForCode("not_a_real_code")).toBeNull();
    expect(Object.values(copyForCode(L10_MEETING_ALREADY_OPEN) ?? "")).not.toContain(leak);
  });

  it("startMeeting 409 l10_meeting_already_open exposes the code and meeting id, not the error text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: leak, code: L10_MEETING_ALREADY_OPEN, meeting_id: "meet-open" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    const result = await createL10Api("operations").startMeeting("team-host");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("conflict");
    expect(result.code).toBe(L10_MEETING_ALREADY_OPEN);
    expect(result.meetingId).toBe("meet-open");
    expect(copyForCode(result.code)).toBe("This team already has a meeting running.");
    expect(copyForCode(result.code)).not.toContain(leak);
    expect(JSON.stringify(result.fieldErrors)).not.toContain(leak);
  });

  it("maps 409 l10_auto_headline_locked from PATCH/DELETE by code only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: leak, code: L10_AUTO_HEADLINE_LOCKED }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    const api = createL10Api("operations");
    const patched = await api.addHeadline("team-host", { body: "nope" });
    expect(patched.ok).toBe(false);
    if (patched.ok) return;
    expect(patched.code).toBe(L10_AUTO_HEADLINE_LOCKED);
    expect(copyForCode(patched.code)).toBe("This headline can't be edited or deleted. Dismiss it instead.");
    expect(copyForCode(patched.code)).not.toBe(leak);
  });
});
