import type { FormField, FormRoute, FormSchema } from "../schema";

// ============================================================
// Missio weekly feedback — the template (Hub Forms F4)
// ============================================================
// Marlon's House Church Weekly Feedback (Google Form, 22 Nov 2026),
// questions 4–23, plus what Jack approved on top:
//
//   - First-timers stay a count. An optional "Yes, I can share a
//     name" box (off by default) opens a name and phone, and only
//     then does the person go to follow-up.
//   - Optional prayer as the last question, to the Care board
//     (pastors only).
//
// Questions 1–3 (house number, leaders, which Sunday) are not
// questions here: the house link or the leader's login already
// knows the house, and the server works out the Sunday.
//
// Every key is the missio_house_feedback column it writes (390),
// so the route is plain: write_column, target = key. Field ids are
// fixed so a seeded form and this file always line up.
//
// This file is the only definition. The seed script
// (supabase/scripts/ops/seed_missio_weekly_feedback.ts) writes it to
// public.forms; no migration inserts it.
// ============================================================

export const MISSIO_WEEKLY_FEEDBACK_SLUG = "missio-weekly-feedback";
export const MISSIO_WEEKLY_FEEDBACK_NAME = "Missio weekly feedback";

export const WIN_TYPES = [
  "New people joined / a guest came",
  "Deeper friendships and community",
  "Powerful prayer or worship",
  "Great Bible discussion",
  "Someone took a next step in faith",
  "Serving or outreach together",
  "Other",
] as const;

/** The one challenge that tells the coach straight away. */
export const CONFLICT_CHALLENGE = "Conflict or tension in the group";

export const CHALLENGE_TYPES = [
  "Low attendance",
  "Finding space or a venue",
  "Time and scheduling",
  "Connecting with new people",
  "Leading the discussion",
  "Keeping people connected during the week",
  "Leader capacity or tiredness",
  CONFLICT_CHALLENGE,
  "Other",
] as const;

export const ACTIVITIES = [
  "Worship",
  "Prayer",
  "Bible discussion",
  "Shared meal",
  "Testimonies",
  "Outreach",
  "Serving together",
  "Communion",
  "Other",
] as const;

export const NO_HELP_NEEDED = "No help needed right now";

export const TRAINING_NEEDS = [
  NO_HELP_NEEDED,
  "Leading a discussion",
  "Discipleship",
  "Prayer",
  "Caring for people",
  "Handling conflict",
  "Inviting new people",
  "Hospitality",
  "Multiplying the group",
  "Other",
] as const;

/** Anything but "No help needed" is a training need. */
export const TRAINING_ASKS: string[] = TRAINING_NEEDS.filter((t) => t !== NO_HELP_NEEDED);

/** Leader scores that tell the coach. */
export const LOW_LEADER_SCORES = [1, 2] as const;

/** The ministry counts top out at 6, which means "more than 5". */
export const FRUIT_MAX = 6;

// ────────────────────────────────────────────────────────────
// Builders
// ────────────────────────────────────────────────────────────

const column = (key: string): FormRoute => ({ action: "write_column", target: key, when: "always" });

function count(key: string, label: string, extra: Partial<FormField> = {}): FormField {
  return {
    id: `wf_${key}`,
    type: "stepper",
    label,
    key,
    required: true,
    min: 0,
    max: 500,
    routes: [column(key)],
    ...extra,
  };
}

function fruit(key: string, label: string, extra: Partial<FormField> = {}): FormField {
  return count(key, label, { max: FRUIT_MAX, maxLabel: "More than 5", ...extra });
}

function scale(key: string, label: string, minLabel: string, maxLabel: string, extra: Partial<FormField> = {}): FormField {
  return {
    id: `wf_${key}`,
    type: "linear_scale",
    label,
    key,
    required: true,
    min: 1,
    max: 5,
    minLabel,
    maxLabel,
    routes: [column(key)],
    ...extra,
  };
}

const SHARE_FIELD_ID = "wf_share_name";

/** Shown only when the leader ticks "Yes, I can share a name". */
function shared(field: Omit<FormField, "parentFieldId" | "showWhenValue">): FormField {
  return { ...field, parentFieldId: SHARE_FIELD_ID, showWhenValue: "true" };
}

// ────────────────────────────────────────────────────────────
// The schema
// ────────────────────────────────────────────────────────────

export function missioWeeklyFeedbackSchema(): FormSchema {
  return {
    version: 1,
    branding: { logoUrl: null, accentColor: "#17372F" },
    steps: [
      {
        id: "wf_numbers",
        title: "Numbers this Sunday",
        fields: [
          count("attendance", "How many people attended?", {
            helpText: "Count everyone, including leaders and children.",
          }),
          count("first_time_count", "First time?"),
          count("guest_count", "Guests (not staff)"),
          {
            id: SHARE_FIELD_ID,
            type: "checkbox",
            label: "Yes, I can share a name",
            key: "share_name",
            required: false,
            helpText: "Stays a count unless you add someone for follow-up. Off by default.",
          },
          shared({
            id: "wf_first_name",
            type: "text",
            label: "Their first name",
            key: "first_name",
            required: true,
            helpText: "Only if they said they are happy for a pastor to follow up.",
            routes: [
              { action: "create_or_update_contact", target: "first_name", when: "always" },
              { action: "open_followup", target: "pastors", when: "always" },
            ],
          }),
          shared({
            id: "wf_last_name",
            type: "text",
            label: "Their surname",
            key: "last_name",
            required: false,
            routes: [{ action: "create_or_update_contact", target: "last_name", when: "always" }],
          }),
          shared({
            id: "wf_phone",
            type: "phone",
            label: "Their phone number",
            key: "phone",
            required: true,
            helpText: "So a pastor can reach them.",
            routes: [{ action: "create_or_update_contact", target: "phone", when: "always" }],
          }),
          count("member_count", "In the house in total", {
            helpText: "Regular members, whether or not they came.",
          }),
          count("invited_count", "Invited this week"),
        ],
      },
      {
        id: "wf_fruit",
        title: "Fruit this Sunday",
        fields: [
          fruit("saved_count", "Got saved", {
            routes: [column("saved_count"), { action: "slack", target: "pastors", when: "gt", whenValue: 0 }],
          }),
          fruit("recommitted_count", "Recommitted to the Lord"),
          fruit("prophetic_count", "Received a prophetic word"),
          fruit("healing_count", "Received physical healing"),
          fruit("deliverance_count", "Received deliverance"),
        ],
      },
      {
        id: "wf_stories",
        title: "Wins, challenges, testimonies",
        fields: [
          {
            id: "wf_win_type",
            type: "dropdown",
            label: "Biggest win — what type?",
            key: "win_type",
            required: true,
            options: [...WIN_TYPES],
            routes: [column("win_type")],
          },
          {
            id: "wf_win_notes",
            type: "long_text",
            label: "Biggest win — tell us more",
            key: "win_notes",
            required: true,
            routes: [column("win_notes")],
          },
          {
            id: "wf_challenge_type",
            type: "dropdown",
            label: "Biggest challenge — what type?",
            key: "challenge_type",
            required: true,
            options: [...CHALLENGE_TYPES],
            routes: [
              column("challenge_type"),
              { action: "slack", target: "coach", when: "equals", whenValue: CONFLICT_CHALLENGE },
            ],
          },
          {
            id: "wf_challenge_notes",
            type: "long_text",
            label: "Biggest challenge — tell us more",
            key: "challenge_notes",
            required: true,
            routes: [column("challenge_notes")],
          },
          {
            id: "wf_testimonies",
            type: "long_text",
            label: "Testimonies?",
            key: "testimonies",
            required: false,
            helpText: "Only share what the person is happy for us to share. No names.",
            routes: [column("testimonies")],
          },
        ],
      },
      {
        id: "wf_how",
        title: "How did it go?",
        fields: [
          scale("connected_score", "How connected did your group feel?", "Not connected", "Very connected"),
          scale("welcome_score", "How welcome would a new person have felt?", "Not welcome", "Very welcome"),
          {
            id: "wf_activities",
            type: "multiselect",
            label: "What did you do this Sunday?",
            key: "activities",
            required: true,
            options: [...ACTIVITIES],
            routes: [column("activities")],
          },
          scale("leader_score", "How are you doing as a leader?", "Struggling", "Doing great", {
            routes: [
              column("leader_score"),
              { action: "slack", target: "coach", when: "in", whenValue: [...LOW_LEADER_SCORES] },
            ],
          }),
          {
            id: "wf_training_needs",
            type: "multiselect",
            label: "You need assistance or training in?",
            key: "training_needs",
            required: true,
            options: [...TRAINING_NEEDS],
            routes: [
              column("training_needs"),
              { action: "slack", target: "coach", when: "in", whenValue: TRAINING_ASKS },
            ],
          },
          {
            id: "wf_prayer",
            type: "long_text",
            label: "Prayer needs",
            key: "prayer",
            required: false,
            helpText: "Only your coach and the pastors see this. It lands on the Care board.",
            // The words stay on the Care board; a Slack card never quotes them.
            routes: [column("prayer"), { action: "care_board", target: "prayer", when: "always" }],
          },
        ],
      },
    ],
    thankYou: {
      heading: "Thank you.",
      message: "We are praying for you and your house church this week.",
    },
  };
}

/** The public.forms row the seed script writes (390 columns included). */
export function missioWeeklyFeedbackFormRow() {
  return {
    slug: MISSIO_WEEKLY_FEEDBACK_SLUG,
    name: MISSIO_WEEKLY_FEEDBACK_NAME,
    description: "Filled once per house church each week, about five minutes. No names of guests unless they opt in.",
    schema: missioWeeklyFeedbackSchema(),
    event_id: null,
    label_id: null,
    is_active: true,
    records_attendance: false,
    kind: "missio_weekly_feedback",
    access_mode: "token",
    subject_type: "house",
  } as const;
}

// ────────────────────────────────────────────────────────────
// Mood — 339 still needs one (NOT NULL), the new form does not ask
// ────────────────────────────────────────────────────────────

export type DerivedMood = "hard" | "okay" | "good" | "great";

/**
 * The 339 history board colours each week by mood, and the column is
 * NOT NULL, but Marlon's form has no mood question. It is read off
 * "how connected did your group feel" instead: 1–2 hard, 3 okay,
 * 4 good, 5 great.
 */
export function moodFromConnected(score: unknown): DerivedMood {
  const n = typeof score === "number" ? score : Number(score);
  if (n >= 5) return "great";
  if (n >= 4) return "good";
  if (n >= 3) return "okay";
  return Number.isFinite(n) && n >= 1 ? "hard" : "okay";
}
