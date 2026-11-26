import { CONFLICT_CHALLENGE, NO_HELP_NEEDED, missioWeeklyFeedbackSchema } from "@/lib/forms/templates/missio-weekly-feedback";
import type { FeedbackRow, ResultsHouse } from "./sunday-results";

// Made-up data for tests and the screenshot route only. House 18 and
// Sunday 22 Nov 2026 follow the approved mockups; every number is
// invented. Never inserted into any database.

export const FIXTURE_SUNDAY = "2026-11-22";

export const FIXTURE_HOUSES: ResultsHouse[] = Array.from({ length: 20 }, (_, i) => ({
  id: `00000000-0000-4000-8000-0000000000${String(i + 1).padStart(2, "0")}`,
  number: i + 1,
  name: null,
}));

const base = {
  meeting_date: FIXTURE_SUNDAY,
  first_time_count: 0,
  guest_count: 1,
  invited_count: 2,
  saved_count: 0,
  healing_count: 0,
  connected_score: 4,
  welcome_score: 4,
  leader_score: 4,
  challenge_type: "Time and scheduling",
  training_needs: [NO_HELP_NEEDED],
};

const row = (n: number, extra: Partial<FeedbackRow>): FeedbackRow => ({
  ...base,
  house_church_id: FIXTURE_HOUSES[n - 1].id,
  ...extra,
});

export const FIXTURE_ROWS: FeedbackRow[] = [
  row(1, { attendance: 12 }),
  row(2, { attendance: 9, first_time_count: 1 }),
  row(4, { attendance: 8, challenge_type: CONFLICT_CHALLENGE, connected_score: 3 }),
  row(5, { attendance: 15, first_time_count: 2, connected_score: 5, invited_count: 4 }),
  row(6, { attendance: 11, saved_count: 1, healing_count: 1 }),
  row(8, { attendance: 7, invited_count: 4 }),
  row(10, { attendance: 10, welcome_score: 5 }),
  row(11, { attendance: 13, training_needs: ["Discipleship"] }),
  row(
    13,
    { attendance: 14, testimonies: "A guest said they felt at peace during worship and want to come back", invited_count: 3 }
  ),
  row(14, { attendance: 6, saved_count: 1, healing_count: 2 }),
  row(15, { attendance: 9, connected_score: 3 }),
  row(17, { attendance: 11, leader_score: 2, connected_score: 3, guest_count: 0 }),
  row(18, {
    attendance: 11,
    first_time_count: 1,
    guest_count: 4,
    invited_count: 3,
    connected_score: 3,
    win_type: "Deeper friendships and community",
    win_notes: "Two quieter people stayed to talk after, and the group prayed for one of them",
    training_needs: ["Discipleship", "Inviting new people"],
  }),
  row(20, { attendance: 16, saved_count: 1, first_time_count: 1, healing_count: 1 }),
];

/** House 18's answers, as in fill.html. */
export const FIXTURE_FILL = {
  houseNumber: 18,
  leaders: "Wikus & Allyson Roestorf, Jack & Krissy",
  meetingDate: FIXTURE_SUNDAY,
  lastAttendance: 12,
  sentBefore: false,
  schema: missioWeeklyFeedbackSchema(),
  initial: {
    attendance: 11,
    first_time_count: 1,
    guest_count: 4,
    member_count: 12,
    invited_count: 3,
    recommitted_count: 1,
    prophetic_count: 2,
    win_type: "Deeper friendships and community",
    win_notes: "Two people who have been quiet for weeks stayed to talk after, and the group prayed for one of them.",
    challenge_type: "Keeping people connected during the week",
    challenge_notes: "Midweek chat is quiet. We need a simple midweek prompt that is not another meeting.",
    testimonies: "A guest said they felt at peace during worship and want to come back.",
    connected_score: 3,
    welcome_score: 4,
    activities: ["Worship", "Prayer", "Bible discussion", "Testimonies"],
    leader_score: 4,
    training_needs: ["Discipleship", "Inviting new people"],
  } as Record<string, unknown>,
};
