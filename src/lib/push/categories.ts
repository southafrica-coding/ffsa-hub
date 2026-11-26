// ────────────────────────────────────────────────────────────
// Phone push: kinds, categories and the ONLY text a push may carry
// ────────────────────────────────────────────────────────────
// A push is shown on a lock screen, so it says what kind of thing is waiting
// and nothing else: no names, amounts, titles, notes or places (Apple 4.5.4).
// Callers pass a kind; the title and body come from PUSH_TEXT here, never
// from the caller, so a route can't leak details by accident.
//
// A category is what a person can switch off (Me > Notifications in the
// app). Several kinds may share one category. Android shows each category
// as its own notification channel, so the keys are also channel ids: keep
// them in step with apps/mobile/src/features/push/categories.ts.
// ────────────────────────────────────────────────────────────

export const PUSH_CATEGORIES = {
  booking_requests: {
    label: "Booking requests to approve",
    description: "When someone asks to book a space you approve.",
  },
  booking_updates: {
    label: "Your bookings",
    description: "When a booking you asked for is approved or declined.",
  },
  training_care: {
    label: "Students who need care",
    description: "When a student you lead or walk with is flagged as needing care.",
  },
  training_week: {
    label: "Your week in Training",
    description: "Monday morning, when something needs you this week (if you're not on Slack).",
  },
} as const;

export type PushCategory = keyof typeof PUSH_CATEGORIES;

export const PUSH_KINDS = {
  booking_request: "booking_requests",
  booking_decision: "booking_updates",
  training_needs_care: "training_care",
  training_briefing: "training_week",
} as const satisfies Record<string, PushCategory>;

export type PushKind = keyof typeof PUSH_KINDS;

const PUSH_TEXT: Record<PushKind, { title: string; body: string }> = {
  booking_request: {
    title: "Booking request waiting",
    body: "A new booking request is waiting for you. Open FFSA Hub to review it.",
  },
  booking_decision: {
    title: "Booking update",
    body: "There's a decision on your booking request. Open FFSA Hub to see it.",
  },
  training_needs_care: {
    title: "A student needs care",
    body: "A check-in was flagged. Open FFSA Hub to see it.",
  },
  training_briefing: {
    title: "Your week in Training",
    body: "A few things need you this week. Open the Training tab to see them.",
  },
};

export function categoryFor(kind: PushKind): PushCategory {
  return PUSH_KINDS[kind];
}

/** The generic, lock-screen-safe title and body for a kind. */
export function pushText(kind: PushKind): { title: string; body: string } {
  return PUSH_TEXT[kind];
}

export function isPushCategory(key: string): key is PushCategory {
  return Object.prototype.hasOwnProperty.call(PUSH_CATEGORIES, key);
}

/** The categories the phone shows as switches. */
export function pushCategoryList(): { key: PushCategory; label: string; description: string }[] {
  return (Object.keys(PUSH_CATEGORIES) as PushCategory[]).map((key) => ({
    key,
    label: PUSH_CATEGORIES[key].label,
    description: PUSH_CATEGORIES[key].description,
  }));
}
