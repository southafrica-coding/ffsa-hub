import { describe, expect, it } from "vitest";
import {
  averageRating,
  buildConfirmSummary,
  buildEndMeetingPayload,
  dmStatus,
  formatAverage,
  readEndResponse,
  recapStatus,
  type Person,
} from "./followup";
import { readEndResult } from "./api";
import type { L10Issue, L10Todo } from "./types";

// Made-up people and items. No real data.
const AMY: Person = { id: "u-amy", name: "Amy Adams" };
const BEN: Person = { id: "u-ben", name: "Ben Brown" };
const CAL: Person = { id: "u-cal", name: "Cal Cole" };
const MEETING = "m-1";

function todo(id: string, owner: string | null, extra: Partial<L10Todo> = {}): L10Todo {
  return {
    id,
    title: `Todo ${id}`,
    owner_id: owner,
    due_on: null,
    done: false,
    done_at: null,
    source_meeting_id: null,
    created_at: "2026-11-20T08:00:00Z",
    ...extra,
  };
}

function issue(id: string, extra: Partial<L10Issue> = {}): L10Issue {
  return {
    id,
    title: `Issue ${id}`,
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

describe("buildEndMeetingPayload", () => {
  it("sends only { user_id, rating } entries under ratings", () => {
    expect(
      buildEndMeetingPayload([
        { user_id: AMY.id, rating: 9 },
        { user_id: BEN.id, rating: 7 },
      ])
    ).toEqual({ ratings: [{ user_id: AMY.id, rating: 9 }, { user_id: BEN.id, rating: 7 }] });
  });

  it("leaves out missing and invalid ratings", () => {
    const payload = buildEndMeetingPayload([
      { user_id: AMY.id, rating: 8 },
      { user_id: BEN.id, rating: null },
      { user_id: CAL.id, rating: undefined },
      { user_id: "u-x", rating: 11 },
      { user_id: "u-y", rating: 0 },
      { user_id: "u-z", rating: 7.5 },
    ]);
    expect(payload).toEqual({ ratings: [{ user_id: AMY.id, rating: 8 }] });
    expect(Object.keys(payload)).toEqual(["ratings"]);
  });

  it("never emits an attendee twice (first entry wins)", () => {
    expect(
      buildEndMeetingPayload([
        { user_id: AMY.id, rating: 6 },
        { user_id: AMY.id, rating: 10 },
        { user_id: BEN.id, rating: null },
        { user_id: BEN.id, rating: 5 },
      ])
    ).toEqual({ ratings: [{ user_id: AMY.id, rating: 6 }] });
  });

  it("is an empty list when nobody rated", () => {
    expect(buildEndMeetingPayload([])).toEqual({ ratings: [] });
    expect(buildEndMeetingPayload([{ user_id: AMY.id, rating: null }])).toEqual({ ratings: [] });
  });
});

describe("averageRating", () => {
  it("averages only the ratings that exist, to one decimal", () => {
    expect(averageRating([8, 9, null, 7, undefined])).toBe(8);
    expect(averageRating([8, 9, 9])).toBe(8.7);
    expect(formatAverage(averageRating([8, 9, 9]))).toBe("8.7");
    expect(averageRating([null])).toBeNull();
    expect(formatAverage(null)).toBe("—");
  });
});

describe("buildConfirmSummary", () => {
  it("counts DMs, the recap post, kept issues and who has not rated", () => {
    const summary = buildConfirmSummary({
      attendees: [AMY, BEN, CAL],
      ratings: { [AMY.id]: 9 },
      todos: [todo("t1", AMY.id), todo("t2", AMY.id), todo("t3", BEN.id, { done: true, done_at: "x" }), todo("t4", "u-out")],
      issues: [issue("i1"), issue("i2", { status: "discussed" }), issue("i3", { status: "solved", solved_at: "x" })],
      hasRecapChannel: true,
    });
    expect(summary).toEqual({
      dmCount: 1,
      recapPosts: 1,
      issuesKept: 2,
      unratedNames: ["Ben Brown", "Cal Cole"],
      todosPerPerson: [{ user_id: AMY.id, name: "Amy Adams", count: 2 }],
    });
  });

  it("has no recap post without a channel", () => {
    const summary = buildConfirmSummary({ attendees: [], ratings: {}, todos: [], issues: [], hasRecapChannel: false });
    expect(summary.recapPosts).toBe(0);
    expect(summary.dmCount).toBe(0);
  });
});

describe("follow-up outcomes", () => {
  it("maps sent / already-sent and posted / already-posted to success", () => {
    expect(dmStatus("sent")).toBe("sent");
    expect(dmStatus("already_sent")).toBe("sent");
    expect(dmStatus("already-sent")).toBe("sent");
    expect(dmStatus("failed")).toBe("failed");
    expect(dmStatus("slack_error_xyz")).toBe("failed");
    expect(dmStatus("skipped")).toBe("skipped");
    expect(dmStatus(undefined)).toBe("unknown");
    expect(recapStatus("posted")).toBe("posted");
    expect(recapStatus("already-posted")).toBe("posted");
    expect(recapStatus("already_posted")).toBe("posted");
    expect(recapStatus("error")).toBe("failed");
    expect(recapStatus(undefined)).toBe("unknown");
  });

  const context = {
    meetingId: MEETING,
    attendees: [AMY, BEN, CAL],
    ratings: { [AMY.id]: 9, [BEN.id]: 8 },
    todos: [
      todo("t1", AMY.id, { source_meeting_id: MEETING }),
      todo("t2", BEN.id, { source_meeting_id: MEETING }),
      todo("t3", CAL.id, { done: true, done_at: "x" }),
    ],
    issues: [
      issue("i1", { status: "solved", solved_at: "x", resolved_meeting_id: MEETING }),
      issue("i2"),
      issue("i3", { status: "discussed" }),
    ],
  };

  it("reads per-person DMs, the recap, totals and the average", () => {
    const view = readEndResponse(
      {
        followup: { results: [{ user_id: AMY.id, outcome: "sent" }, { user_id: BEN.id, outcome: "failed" }] },
        recap: { outcome: "posted" },
      },
      context
    );
    expect(view.people).toEqual([
      { user_id: AMY.id, name: "Amy Adams", count: 1, status: "sent" },
      { user_id: BEN.id, name: "Ben Brown", count: 1, status: "failed" },
    ]);
    expect(view.recap).toBe("posted");
    expect(view.alreadyEnded).toBe(false);
    expect(view.average).toBe(8.5);
    expect(view.ratedCount).toBe(2);
    expect(view.totals).toEqual({ newTodos: 2, issuesSolved: 1, issuesKept: 2 });
    expect(view.carriedTodos).toBe(2);
  });

  it("does not claim success when the server reports nothing", () => {
    const view = readEndResponse({}, context);
    expect(view.people.map((p) => p.status)).toEqual(["unknown", "unknown"]);
    expect(view.recap).toBe("unknown");
  });

  it("reads an already_ended retry, 200 or 409, and keeps its outcomes", () => {
    const retry = readEndResult({
      status: 409,
      ok: false,
      body: {
        already_ended: true,
        followup: { results: [{ user_id: AMY.id, outcome: "already_sent" }, { bad: true }] },
        recap: { outcome: "already_posted" },
      },
    });
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.data.already_ended).toBe(true);
    const view = readEndResponse(retry.data, context);
    expect(view.alreadyEnded).toBe(true);
    expect(view.people[0]?.status).toBe("sent");
    expect(view.recap).toBe("posted");

    const ok = readEndResult({ status: 200, ok: true, body: { already_ended: true } });
    expect(ok.ok && ok.data.already_ended).toBe(true);
  });

  it("keeps server text out of failures, mapping only known fields", () => {
    const failed = readEndResult({
      status: 400,
      ok: false,
      body: { error: "raw db text", fieldErrors: { ratings: "server words", secret_field: "x" } },
    });
    expect(failed).toEqual({
      ok: false,
      kind: "invalid",
      fieldErrors: { ratings: "Ratings are whole numbers from 1 to 10." },
      code: null,
      meetingId: null,
    });
    expect(readEndResult({ status: 409, ok: false, body: { error: "other" } })).toEqual({
      ok: false,
      kind: "conflict",
      fieldErrors: {},
      code: null,
      meetingId: null,
    });
    expect(readEndResult(null)).toEqual({ ok: false, kind: "error", fieldErrors: {}, code: null, meetingId: null });
  });
});
