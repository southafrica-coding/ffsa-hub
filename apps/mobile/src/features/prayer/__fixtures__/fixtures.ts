// Test fixtures for the Prayer Room (not a test file). Placeholder people and
// data only, shaped like the website's /api/prayer-room/* responses (times as
// Postgres sends them, "HH:MM:SS").

import type { PracticeWeek } from "../api";

export const ME_ID = "u1";

/** Tuesday 3 Nov 2026, 08:00 SAST (06:00 UTC). The week is Sun 1 – Sat 7 Nov. */
export const NOW = new Date("2026-11-03T06:00:00.000Z");

export const person = (id: string, first: string, last = "Person") => ({
  id,
  first_name: first,
  last_name: last,
  preferred_name: null,
});

export const SEAT_TYPES = [
  { id: "prayer_lead", label: "Prayer Lead", is_lead: true, category: "lead", sort_order: 1 },
  { id: "worship_lead", label: "Worship Lead", is_lead: true, category: "lead", sort_order: 2 },
  { id: "keys", label: "Keys", is_lead: false, category: "music", sort_order: 3 },
  { id: "vocals", label: "Vocals", is_lead: false, category: "music", sort_order: 4 },
];

export const BANDS = [
  { id: "b1", band_name: "MORNING", day_of_week: 1, start_time: "08:00:00", end_time: "09:30:00", weekly_focus: null },
  { id: "b3", band_name: "NIGHT", day_of_week: 1, start_time: "17:30:00", end_time: "20:00:00", weekly_focus: null },
];

type SlotIn = {
  id: string;
  seat: string;
  status: "open" | "invited" | "filled" | "declined";
  user?: ReturnType<typeof person> | null;
};

export function slot({ id, seat, status, user = null }: SlotIn) {
  return {
    id,
    role: seat,
    seat_type_id: seat,
    status,
    position: 0,
    required_label_id: null,
    filled_user_id: status === "filled" ? (user?.id ?? null) : null,
    invitee_id: status === "invited" || status === "filled" ? (user?.id ?? null) : null,
    invited_at: null,
    responded_at: null,
    filled: status === "filled" ? user : null,
    invitee: status === "invited" || status === "filled" ? user : null,
    required_label: null,
  };
}

export function prayerSet(over: Record<string, unknown> = {}) {
  return {
    id: "s1",
    set_date: "2026-11-03",
    start_time: "19:00:00",
    end_time: "21:00:00",
    title: "Night watch",
    theme: null,
    scripture: null,
    prayer_focus: "South Africa's schools",
    setlist: null,
    status: "scheduled",
    relocation_note: null,
    alt_venue_id: null,
    series_id: null,
    owner_id: "u9",
    owner: person("u9", "Sample Person 59", ""),
    week_start: "2026-11-01",
    slots: [
      slot({ id: "sl1", seat: "prayer_lead", status: "filled", user: person("u2", "Sample Person 199") }),
      slot({ id: "sl2", seat: "worship_lead", status: "open" }),
      slot({ id: "sl3", seat: "keys", status: "filled", user: person(ME_ID, "Sample", "Person") }),
      slot({ id: "sl4", seat: "vocals", status: "open" }),
    ],
    ...over,
  };
}

/** A set nobody leads yet, on Monday morning (in the MORNING band). */
export const UNLED = prayerSet({
  id: "s2",
  set_date: "2026-11-02",
  start_time: "08:00:00",
  end_time: "09:30:00",
  title: "Morning devo",
  owner_id: "u9",
  slots: [slot({ id: "sl5", seat: "prayer_lead", status: "open" }), slot({ id: "sl6", seat: "keys", status: "invited", user: person(ME_ID, "Sample", "Person") })],
});

export const WALL_META = { seatTypes: SEAT_TYPES, bands: BANDS };

export const BLOCKOUT = {
  id: "bo1",
  block_date: "2026-11-05",
  end_date: "2026-11-05",
  start_time: "10:00:00",
  end_time: "12:00:00",
  reason: "Staff meeting",
  relocation_note: "Music Room",
  created_by: "u9",
};

// ── Practice ────────────────────────────────────────────────────────────────

export const STATIONS = [
  { id: "st-keys", slug: "keys", label: "Keys", short_label: "KEYS", seat_type_id: "keys", sort_order: 1, max_people: 1 },
  { id: "st-drums", slug: "drums", label: "Drums", short_label: "DRUMS", seat_type_id: "drums", sort_order: 2, max_people: 1 },
  { id: "st-vocals", slug: "vocals", label: "Vocals", short_label: "VOX", seat_type_id: "vocals", sort_order: 3, max_people: 4 },
];

export const PRACTICE_SETTINGS = {
  start_time: "16:00",
  end_time: "17:30",
  slot_minutes: 30,
  closed_weekdays: [2],
  closed_label: "Ministry night",
  max_minutes: 60,
  opens_weekday: 0,
  opens_time: "00:00",
};

export function practiceWeek(over: Partial<Record<keyof PracticeWeek, unknown>> = {}) {
  return {
    settings: PRACTICE_SETTINGS,
    stations: STATIONS,
    bookings: [
      {
        id: "pb1",
        kind: "station",
        practice_date: "2026-11-04",
        start_time: "16:00",
        end_time: "16:30",
        station_id: "st-drums",
        booked_by: "u2",
        band_name: null,
        people: [{ user_id: "u2", station_id: "st-drums", first_name: "Sample Person 199", full_name: "Sample Person 199" }],
      },
      {
        id: "pb2",
        kind: "station",
        practice_date: "2026-11-05",
        start_time: "16:30",
        end_time: "17:30",
        station_id: "st-keys",
        booked_by: ME_ID,
        band_name: null,
        people: [{ user_id: ME_ID, station_id: "st-keys", first_name: "Sample", full_name: "Sample Person" }],
      },
    ],
    days: ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"],
    opensAt: "2026-11-01T00:00",
    nextOpensAt: "2026-11-08T00:00",
    now: "2026-11-03T08:00",
    me: { canBook: true, isStaff: false, defaultStationId: "st-keys" },
    ...over,
  };
}

export const BAND_BOOKING = {
  id: "pb3",
  kind: "band",
  practice_date: "2026-11-06",
  start_time: "16:00",
  end_time: "17:00",
  station_id: null,
  booked_by: "u2",
  band_name: "The Sends",
  people: [{ user_id: "u2", station_id: "st-drums", first_name: "Sample Person 199", full_name: "Sample Person 199" }],
};
