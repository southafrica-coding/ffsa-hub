// Frame 36's afternoon as fixtures, shared by preview-8a (the wall's lane) and
// preview-36 (the PRACTICE tab and its drawers). Dev only.

import {
  DEFAULT_PRACTICE_SETTINGS,
  type PracticeBooking,
  type PracticeStation,
  type PracticeWeek,
} from "@/lib/prayer-room/practice";

// Frame 36a's practice lane, with the frame's own afternoon: a vocal group,
// a 60-minute keys booking that is "yours", a full band, Tuesday closed.
const STATIONS: PracticeStation[] = [
  ["drums", "Drums", "DR"],
  ["keys", "Keys", "KY"],
  ["electric", "Electric", "EL"],
  ["cajon", "Cajon", "CJ"],
  ["acoustic", "Acoustic", "AC"],
  ["bass", "Bass", "BS"],
  ["vocals", "Vocals", "VX"],
].map(([slug, label, short_label], i) => ({
  id: slug,
  slug,
  label,
  short_label,
  seat_type_id: null,
  sort_order: i,
  max_people: slug === "vocals" ? 4 : 1,
}));

export const ME = "me";
let n = 0;
const pb = (date: string, start: string, end: string, station: string | null, who: string[], band?: string): PracticeBooking => ({
  id: `pb-${++n}`,
  kind: band ? "band" : "station",
  practice_date: date,
  start_time: start,
  end_time: end,
  station_id: station,
  booked_by: who[0] ?? ME,
  band_name: band ?? null,
  people: who.map((w) => ({ user_id: w, station_id: station ?? "keys", first_name: w, full_name: w })),
});

export const PRACTICE: PracticeWeek = {
  settings: DEFAULT_PRACTICE_SETTINGS,
  stations: STATIONS,
  bookings: [
    pb("2026-08-03", "16:00", "17:00", "drums", ["Sample Person 199"]),
    pb("2026-08-03", "16:00", "16:30", "keys", ["Sample Person 258"]),
    pb("2026-08-03", "16:30", "17:00", "bass", ["Sample Person 190"]),
    pb("2026-08-03", "16:30", "17:00", "vocals", ["Sample Person 59", "Sample Person 145", "Sample Person 167"]),
    pb("2026-08-05", "16:00", "17:00", null, ["Sample Person 136"], "Thursday night set"),
    pb("2026-08-05", "17:00", "17:30", "acoustic", ["Sample Person 13"]),
    pb("2026-08-06", "16:00", "17:00", "keys", [ME]),
    pb("2026-08-06", "16:30", "17:00", "electric", ["Sample Person 167"]),
    pb("2026-08-06", "16:30", "17:00", "cajon", ["Sample Person 66"]),
    pb("2026-08-06", "16:30", "17:00", "vocals", ["Sample Person 145"]),
    pb("2026-08-07", "16:30", "17:30", "drums", ["Sample Person 199"]),
    pb("2026-08-07", "16:30", "17:30", "bass", ["Sample Person 190"]),
  ],
  closures: [],
  days: ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"],
  opensAt: "2026-08-02T00:00",
  nextOpensAt: "2026-08-09T00:00",
  now: "2026-08-06T14:20",
  me: { canBook: true, isStaff: false, defaultStationId: "keys" },
};

