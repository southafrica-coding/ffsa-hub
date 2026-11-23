import { diffDays, isIsoDate, isTime } from "./dates";

// ============================================================
// Missio yearly calendar — shapes shared by the API, the feed and the UI
// ============================================================
// Pastors add events in four categories. A fifth, "national" (public
// holidays and school terms), comes from code (south-africa.ts) and is
// never a database row.
// ============================================================

export const MISSIO_EVENT_CATEGORIES = ["sundays", "house_church", "events", "leaders"] as const;
export type MissioEventCategory = (typeof MISSIO_EVENT_CATEGORIES)[number];

export const CALENDAR_CATEGORIES = [...MISSIO_EVENT_CATEGORIES, "national"] as const;
export type CalendarCategory = (typeof CALENDAR_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<CalendarCategory, string> = {
  sundays: "Sundays & special services",
  house_church: "House church terms & breaks",
  events: "Events, camps & outreaches",
  leaders: "Leader meetings & trainings",
  national: "Public holidays & school terms",
};

/** Short words for a chip, so colour is never the only clue. */
export const CATEGORY_SHORT: Record<CalendarCategory, string> = {
  sundays: "Sunday",
  house_church: "House church",
  events: "Event",
  leaders: "Leaders",
  national: "Holiday / school",
};

export const CAMPUSES = ["all", "potch", "jhb"] as const;
export type CalendarCampus = (typeof CAMPUSES)[number];

export const CAMPUS_LABEL: Record<CalendarCampus, string> = {
  all: "All campuses",
  potch: "Potch",
  jhb: "JHB",
};

export type CalendarRepeat = {
  /** Every n weeks, on the start date's weekday. */
  every: number;
  /** Last day a repeat may start on (inclusive). */
  until: string | null;
  /** Number of times, including the first. */
  count: number | null;
};

export type CalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  category: CalendarCategory;
  campus: CalendarCampus;
  /** First day (Johannesburg). */
  startsOn: string;
  /** Last day, inclusive. The feed turns it into an exclusive DTEND. */
  endsOn: string;
  /** "HH:MM" in Johannesburg. Null for an all-day event. */
  startTime: string | null;
  endTime: string | null;
  repeat: CalendarRepeat | null;
  /** Dates (each a repeat's first day) left out of a weekly series. */
  skipDates: string[];
  source: "missio" | "national";
  /** A second line, e.g. "Educators until 11 Dec". National items only. */
  note?: string | null;
  updatedAt?: string | null;
};

export type CalendarEventInput = {
  title: string;
  description: string | null;
  location: string | null;
  category: MissioEventCategory;
  campus: CalendarCampus;
  startsOn: string;
  endsOn: string;
  startTime: string | null;
  endTime: string | null;
  repeat: CalendarRepeat | null;
  skipDates: string[];
};

export const LIMITS = {
  title: 120,
  description: 2000,
  location: 200,
  spanDays: 366,
  repeatEvery: 52,
  repeatCount: 520,
  skipDates: 200,
} as const;

export type FieldErrors = Partial<Record<keyof CalendarEventInput | "repeatUntil" | "repeatCount" | "repeatEvery", string>>;

function text(value: unknown, max: number): string | null | undefined {
  if (value == null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? undefined : trimmed;
}

/**
 * Checks a pastor's event. The database has the same rules as CHECK
 * constraints (migration 395); this gives the form a field to point at.
 */
export function parseEventInput(body: unknown): { ok: true; value: CalendarEventInput } | { ok: false; fieldErrors: FieldErrors } {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const errors: FieldErrors = {};

  const title = text(input.title, LIMITS.title);
  if (!title) errors.title = title === undefined ? `Keep the title under ${LIMITS.title} characters.` : "Give it a title.";
  const description = text(input.description, LIMITS.description);
  if (description === undefined) errors.description = `Keep it under ${LIMITS.description} characters.`;
  const location = text(input.location, LIMITS.location);
  if (location === undefined) errors.location = `Keep it under ${LIMITS.location} characters.`;

  const category = input.category;
  if (!(MISSIO_EVENT_CATEGORIES as readonly unknown[]).includes(category)) errors.category = "Pick a category.";
  const campus = input.campus ?? "all";
  if (!(CAMPUSES as readonly unknown[]).includes(campus)) errors.campus = "Pick a campus.";

  const startsOn = input.startsOn;
  const endsOn = input.endsOn ?? input.startsOn;
  if (!isIsoDate(startsOn)) errors.startsOn = "Pick a start date.";
  if (!isIsoDate(endsOn)) errors.endsOn = "Pick an end date.";
  else if (isIsoDate(startsOn)) {
    if (diffDays(startsOn, endsOn) < 0) errors.endsOn = "The end is before the start.";
    else if (diffDays(startsOn, endsOn) > LIMITS.spanDays) errors.endsOn = "Keep one event under a year.";
  }

  const startTime = input.startTime == null || input.startTime === "" ? null : input.startTime;
  const endTime = input.endTime == null || input.endTime === "" ? null : input.endTime;
  if ((startTime === null) !== (endTime === null)) {
    if (startTime === null) errors.startTime = "Add a start time, or make it all day.";
    else errors.endTime = "Add an end time, or make it all day.";
  } else if (startTime !== null) {
    if (!isTime(startTime)) errors.startTime = "Use a time like 09:30.";
    if (!isTime(endTime)) errors.endTime = "Use a time like 11:00.";
    if (isTime(startTime) && isTime(endTime) && startsOn === endsOn && endTime <= startTime) {
      errors.endTime = "The end is before the start.";
    }
  }

  let repeat: CalendarRepeat | null = null;
  const rawRepeat = input.repeat as Record<string, unknown> | null | undefined;
  if (rawRepeat && typeof rawRepeat === "object") {
    const every = Number(rawRepeat.every ?? 1);
    const until = rawRepeat.until == null || rawRepeat.until === "" ? null : rawRepeat.until;
    const count = rawRepeat.count == null || rawRepeat.count === "" ? null : Number(rawRepeat.count);
    if (!Number.isInteger(every) || every < 1 || every > LIMITS.repeatEvery) errors.repeatEvery = `Every 1 to ${LIMITS.repeatEvery} weeks.`;
    if (until !== null && count !== null) errors.repeatUntil = "Pick an end date or a number of times, not both.";
    if (until !== null && !isIsoDate(until)) errors.repeatUntil = "Pick the last date.";
    else if (until !== null && isIsoDate(startsOn) && diffDays(startsOn, until as string) < 0) errors.repeatUntil = "The last date is before the first.";
    if (count !== null && (!Number.isInteger(count) || count < 1 || count > LIMITS.repeatCount)) {
      errors.repeatCount = `1 to ${LIMITS.repeatCount} times.`;
    }
    if (isIsoDate(startsOn) && isIsoDate(endsOn) && Number.isInteger(every) && every >= 1 && diffDays(startsOn, endsOn) >= every * 7) {
      errors.endsOn = "A weekly event has to end before the next one starts.";
    }
    repeat = { every, until: (until as string | null) ?? null, count };
  }

  const rawSkips = Array.isArray(input.skipDates) ? input.skipDates : [];
  const skipDates = [...new Set(rawSkips)].filter(isIsoDate).sort();
  if (rawSkips.length > LIMITS.skipDates || skipDates.length !== new Set(rawSkips).size) errors.skipDates = "Those skipped dates don’t look right.";
  if (!repeat && skipDates.length > 0) errors.skipDates = "Only a repeating event can skip a date.";

  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };
  return {
    ok: true,
    value: {
      title: title as string,
      description: description ?? null,
      location: location ?? null,
      category: category as MissioEventCategory,
      campus: campus as CalendarCampus,
      startsOn: startsOn as string,
      endsOn: endsOn as string,
      startTime: startTime as string | null,
      endTime: endTime as string | null,
      repeat,
      skipDates,
    },
  };
}

// ── Database rows ───────────────────────────────────────────

export type CalendarEventRow = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  category: string;
  campus: string;
  starts_on: string;
  ends_on: string;
  start_time: string | null;
  end_time: string | null;
  repeat_weekly_interval: number | null;
  repeat_until: string | null;
  repeat_count: number | null;
  skip_dates: string[] | null;
  updated_at?: string | null;
};

export const EVENT_COLUMNS =
  "id, title, description, location, category, campus, starts_on, ends_on, start_time, end_time, repeat_weekly_interval, repeat_until, repeat_count, skip_dates, updated_at";

/** Postgres `time` comes back as "HH:MM:SS". */
function hhmm(value: string | null): string | null {
  return value ? value.slice(0, 5) : null;
}

export function rowToEvent(row: CalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    category: (MISSIO_EVENT_CATEGORIES as readonly string[]).includes(row.category) ? (row.category as MissioEventCategory) : "events",
    campus: (CAMPUSES as readonly string[]).includes(row.campus) ? (row.campus as CalendarCampus) : "all",
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    startTime: hhmm(row.start_time),
    endTime: hhmm(row.end_time),
    repeat: row.repeat_weekly_interval
      ? { every: row.repeat_weekly_interval, until: row.repeat_until, count: row.repeat_count }
      : null,
    skipDates: row.skip_dates ?? [],
    source: "missio",
    updatedAt: row.updated_at ?? null,
  };
}

export function inputToRow(input: CalendarEventInput) {
  return {
    title: input.title,
    description: input.description,
    location: input.location,
    category: input.category,
    campus: input.campus,
    starts_on: input.startsOn,
    ends_on: input.endsOn,
    start_time: input.startTime,
    end_time: input.endTime,
    repeat_weekly_interval: input.repeat?.every ?? null,
    repeat_until: input.repeat?.until ?? null,
    repeat_count: input.repeat?.count ?? null,
    skip_dates: input.repeat ? input.skipDates : [],
  };
}
