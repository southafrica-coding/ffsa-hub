import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { L10_ATTENDEE_IMMUTABLE, L10_RATING_NOT_ALLOWED } from "./api";
import { buildConfirmSummary, buildEndMeetingPayload, recapChannelLabel, type Person } from "./followup";
import { ConcludeBody, type MeetingActions, type MeetingCtx } from "./meeting-segments";
import { ConfirmDialog } from "./meeting-sheets";
import { allowedRatingEntries, canRateAttendee, canRateOthers, type RatingRights } from "./ratings";
import type { L10TeamDetail } from "./types";
import { failureCopy } from "./ui";

const ME = "user-me";
const OTHER = "user-other";
const THIRD = "user-third";

const member: RatingRights = { viewerId: ME, canManage: false, facilitatorId: null };
const leader: RatingRights = { viewerId: ME, canManage: true, facilitatorId: null };
const facilitator: RatingRights = { viewerId: ME, canManage: false, facilitatorId: ME };

const NOT_ON_TEAM = "You're not on this team, so you can't see its L10.";

describe("who may rate whom (#741 endMeeting)", () => {
  it("lets a member rate only themself", () => {
    expect(canRateOthers(member)).toBe(false);
    expect(canRateAttendee(member, ME)).toBe(true);
    expect(canRateAttendee(member, OTHER)).toBe(false);
  });

  it("lets a leader or overseer (canManage) rate anyone", () => {
    expect(canRateOthers(leader)).toBe(true);
    expect(canRateAttendee(leader, OTHER)).toBe(true);
    expect(canRateAttendee(leader, ME)).toBe(true);
  });

  it("lets the facilitator rate anyone even without canManage", () => {
    expect(canRateOthers(facilitator)).toBe(true);
    expect(canRateAttendee(facilitator, OTHER)).toBe(true);
  });

  it("does not treat someone else's facilitation as the viewer's", () => {
    const rights = { viewerId: ME, canManage: false, facilitatorId: OTHER };
    expect(canRateOthers(rights)).toBe(false);
    expect(canRateAttendee(rights, OTHER)).toBe(false);
    expect(canRateAttendee(rights, ME)).toBe(true);
  });

  it("lets an unknown viewer rate nobody", () => {
    const rights = { viewerId: null, canManage: true, facilitatorId: null };
    expect(canRateOthers(rights)).toBe(false);
    expect(canRateAttendee(rights, ME)).toBe(false);
    expect(canRateAttendee({ viewerId: null, canManage: false, facilitatorId: null }, OTHER)).toBe(false);
  });
});

const attendees: Person[] = [
  { id: ME, name: "Test Me" },
  { id: OTHER, name: "Test Other" },
  { id: THIRD, name: "Test Third" },
];

describe("end payload follows the rating rule", () => {
  const ratings = { [ME]: 9, [OTHER]: 6, [THIRD]: 8 };

  it("sends only the member's own rating, even when others' already exist", () => {
    expect(buildEndMeetingPayload(allowedRatingEntries(attendees, ratings, member))).toEqual({
      ratings: [{ user_id: ME, rating: 9 }],
    });
  });

  it("sends everyone's rating for a leader or the facilitator", () => {
    const all = {
      ratings: [
        { user_id: ME, rating: 9 },
        { user_id: OTHER, rating: 6 },
        { user_id: THIRD, rating: 8 },
      ],
    };
    expect(buildEndMeetingPayload(allowedRatingEntries(attendees, ratings, leader))).toEqual(all);
    expect(buildEndMeetingPayload(allowedRatingEntries(attendees, ratings, facilitator))).toEqual(all);
  });

  it("sends nothing for an unknown viewer", () => {
    const rights = { viewerId: null, canManage: false, facilitatorId: null };
    expect(buildEndMeetingPayload(allowedRatingEntries(attendees, ratings, rights))).toEqual({ ratings: [] });
  });
});

function ctxFor(
  rights: RatingRights,
  ratings: Record<string, number | null> = {},
  recapChannel: string | null = null
): MeetingCtx {
  const actions: MeetingActions = {
    raiseIssue: vi.fn(async () => true),
    toggleTodo: vi.fn(),
    updateIssue: vi.fn(async () => true),
    rank: vi.fn(),
    dropIssue: vi.fn(async () => true),
    solveIssue: vi.fn(),
    setRating: vi.fn(),
    requestEnd: vi.fn(),
    dismissHeadline: vi.fn(),
    restoreHeadline: vi.fn(),
  };
  return {
    meetingId: "meeting-1",
    meetingStartedAt: "2026-11-26T07:00:00.000Z",
    zone: "Africa/Johannesburg",
    detail: { todos: [], issues: [], headlines: [], members: [] } as unknown as L10TeamDetail,
    teams: [],
    people: attendees,
    attendees,
    ratings,
    ratingRights: rights,
    recapChannel,
    now: Date.UTC(2026, 10, 26, 7, 30),
    busy: new Set(),
    actions,
  };
}

function render(rights: RatingRights, ratings?: Record<string, number | null>) {
  return renderToStaticMarkup(<ConcludeBody ctx={ctxFor(rights, ratings)} />);
}

describe("Conclude rating rows", () => {
  it("gives a member a stepper only on their own row", () => {
    const html = render(member, { [OTHER]: 6 });
    expect(html).toContain("Rating for Test Me");
    expect(html).toContain("Raise Test Me&#x27;s rating");
    expect(html).not.toContain("Rating for Test Other");
    expect(html).not.toContain("Raise Test Other&#x27;s rating");
    expect(html).not.toContain("Lower Test Other&#x27;s rating");
    expect(html).not.toContain("Raise Test Third&#x27;s rating");
    // Other rows stay visible, read-only.
    expect(html).toContain("Test Other");
    expect(html).toContain("Test Other&#x27;s rating: 6");
    expect(html).toContain("Test Third has not rated yet");
    expect(html).toMatch(/>Not rated</);
  });

  it("gives a leader (canManage) a stepper on every row", () => {
    const html = render(leader);
    for (const person of attendees) expect(html).toContain(`Raise ${person.name}&#x27;s rating`);
  });

  it("gives the facilitator a stepper on every row without canManage", () => {
    const html = render(facilitator);
    for (const person of attendees) expect(html).toContain(`Raise ${person.name}&#x27;s rating`);
  });

  it("gives an unknown viewer no steppers", () => {
    const html = render({ viewerId: null, canManage: false, facilitatorId: null });
    expect(html).not.toContain("Raise ");
  });
});

describe("end failures use the #741 code before the kind", () => {
  it("maps l10_rating_not_allowed to our rating copy, not the team-membership copy", () => {
    expect(failureCopy("forbidden", L10_RATING_NOT_ALLOWED)).toBe("You can only set your own rating.");
    expect(failureCopy("forbidden", L10_RATING_NOT_ALLOWED)).not.toBe(NOT_ON_TEAM);
  });

  it("maps l10_attendee_immutable to our own copy", () => {
    expect(failureCopy("forbidden", L10_ATTENDEE_IMMUTABLE)).toBe("That person's attendance can't be changed this way.");
  });

  it("falls back to the kind when there is no code", () => {
    expect(failureCopy("forbidden")).toBe(NOT_ON_TEAM);
    expect(failureCopy("forbidden", null)).toBe(NOT_ON_TEAM);
  });

  const summary = { dmCount: 1, recapPosts: 1, issuesKept: 0, unratedNames: [] } as unknown as Parameters<
    typeof ConfirmDialog
  >[0]["summary"];

  function dialog(code: string | null) {
    return renderToStaticMarkup(
      <ConfirmDialog
        summary={summary}
        ending={false}
        failure="forbidden"
        failureCode={code}
        onBack={() => undefined}
        onConfirm={() => undefined}
      />
    );
  }

  it("shows the rating copy in the End dialog for a 403 l10_rating_not_allowed", () => {
    const html = dialog(L10_RATING_NOT_ALLOWED);
    expect(html).toContain("You can only set your own rating.");
    expect(html).not.toContain("not on this team");
  });

  it("shows our attendance copy in the End dialog for a 403 l10_attendee_immutable", () => {
    const html = dialog(L10_ATTENDEE_IMMUTABLE);
    expect(html).toContain("That person&#x27;s attendance can&#x27;t be changed this way.");
    expect(html).not.toContain("not on this team");
  });

  it("keeps the kind fallback in the End dialog when there is no code", () => {
    expect(dialog(null)).toContain("not on this team");
  });
});

describe("Conclude and End copy follow the team's recap channel", () => {
  const live = { name: "Live", slack_channel_id: "C0123ABCD" };
  const quiet = { name: "Live", slack_channel_id: null };

  it("names the channel after the team, never the Slack id", () => {
    expect(recapChannelLabel(live)).toBe("Live channel");
    expect(recapChannelLabel({ name: "  Live  ", slack_channel_id: "C0123ABCD" })).toBe("Live channel");
    // A field the payload didn't send counts as set, as hasRecapChannel does.
    expect(recapChannelLabel({ name: "Live" })).toBe("Live channel");
    expect(recapChannelLabel(quiet)).toBeNull();
  });

  function conclude(team: { name: string; slack_channel_id: string | null }) {
    return renderToStaticMarkup(<ConcludeBody ctx={ctxFor(member, {}, recapChannelLabel(team))} />);
  }

  function endDialog(team: { name: string; slack_channel_id: string | null }) {
    const recapChannel = recapChannelLabel(team);
    return renderToStaticMarkup(
      <ConfirmDialog
        summary={buildConfirmSummary({
          attendees,
          ratings: {},
          todos: [],
          issues: [],
          hasRecapChannel: recapChannel !== null,
        })}
        recapChannel={recapChannel}
        ending={false}
        failure={null}
        onBack={() => undefined}
        onConfirm={() => undefined}
      />
    );
  }

  it("with a channel set: Conclude says the recap is posted, to the named channel", () => {
    const html = conclude(live);
    expect(html).toContain("Ending sends each person a Slack DM with their to-dos and posts the recap to the Live channel.");
    expect(html).not.toContain("C0123ABCD");
    expect(html).not.toContain("team channel");
  });

  it("with no channel: Conclude leaves the recap line out", () => {
    const html = conclude(quiet);
    expect(html).toContain("Ending sends each person a Slack DM with their to-dos. Kept issues and unfinished to-dos");
    expect(html).not.toMatch(/recap to|posts the recap|channel/i);
  });

  it("with a channel set: the End dialog names it and counts one post", () => {
    const html = endDialog(live);
    expect(html).toContain("Everyone with an open to-do gets a Slack DM listing theirs, and the recap goes to the Live channel.");
    expect(html).toContain("Recap to Live channel");
    expect(html).toMatch(/>1<\/span> <span[^>]*>post</);
    expect(html).not.toContain("C0123ABCD");
  });

  it("with no channel: the End dialog doesn't promise a recap", () => {
    const html = endDialog(quiet);
    expect(html).toContain("Everyone with an open to-do gets a Slack DM listing theirs.");
    expect(html).not.toContain("recap goes to");
    expect(html).not.toContain("no recap channel set");
    expect(html).not.toContain("Recap to team channel");
    expect(html).not.toContain("Recap to");
  });
});
