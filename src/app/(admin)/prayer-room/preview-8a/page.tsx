// Dev-only render of frame 8a's WALL against fixtures, so the band treatment
// can be checked at 1440 and 375 without a signed-in session and without
// inventing curated bands in the real database. It renders the SAME <Wall>
// the schedule renders — only the data is a stand-in.
//
// It exists because the bands could not be checked any other way: migration
// 171 added band_name/is_curated but seeded nothing, so every real week draws
// zero bands. Same idiom as bookings/preview-3c.
//
// Not reachable in production: the route 404s outside development.

import { notFound } from "next/navigation";
import Wall, { type WallSet, type SeatType, type Band } from "../components/wall";
import type { CalendarBlockout } from "../components/calendar";

const SEATS: SeatType[] = [
  { id: "prayer_leader", label: "PRAYER LEAD", is_lead: true },
  { id: "worship_leader", label: "WORSHIP LEAD", is_lead: true },
  { id: "keys", label: "KEYS", is_lead: false },
];

// A band is one block per weekday, which is what the wall groups by name.
const band = (name: string, start: string, end: string, focus: string): Band[] =>
  [1, 2, 3, 4, 5].map((d) => ({
    id: `${name}-${d}`,
    band_name: name,
    day_of_week: d,
    start_time: start,
    end_time: end,
    weekly_focus: focus,
  }));

const BANDS: Band[] = [
  ...band("MORNING", "08:00", "09:30", "The nations — Nepal focus"),
  ...band("NOON", "12:00", "14:00", "Send Night, Cape Town"),
  ...band("NIGHT", "17:00", "19:00", "Prophetic worship"),
];

const owner = { id: "u1", first_name: "Tshepo", last_name: "Molefe", preferred_name: null };

const set = (
  id: string,
  date: string,
  start: string,
  end: string,
  title: string,
  lead: boolean
): WallSet => ({
  id,
  set_date: date,
  start_time: start,
  end_time: end,
  title,
  theme: null,
  status: "scheduled",
  relocation_note: null,
  owner,
  // A set is live once a LEAD seat is filled; otherwise it draws dashed.
  slots: lead
    ? [{ status: "filled", seat_type_id: "worship_leader" }, { status: "open", seat_type_id: "keys" }]
    : [{ status: "open", seat_type_id: "prayer_leader" }],
});

// Week of Mon 03 Aug 2026, the week frames 8a and 9a draw.
const SETS: WallSet[] = [
  set("a", "2026-08-03", "05:00", "06:30", "Morning watch", true),
  set("b", "2026-08-03", "08:00", "09:30", "The nations — Nepal focus", true),
  set("c", "2026-08-03", "12:00", "14:00", "Midday intercession", true),
  set("d", "2026-08-03", "17:00", "19:00", "Night set opens", true),
  set("e", "2026-08-04", "08:00", "09:30", "Israel & the Middle East", true),
  set("f", "2026-08-04", "14:00", "15:30", "Send Night prep", false),
  set("g", "2026-08-04", "17:00", "19:00", "Night set opens", true),
  set("h", "2026-08-05", "08:00", "09:30", "Unreached — Central Asia", true),
  set("i", "2026-08-05", "12:00", "14:00", "Midday intercession", true),
  set("j", "2026-08-06", "09:30", "11:00", "Selah — instrumental", true),
  set("k", "2026-08-07", "17:00", "19:00", "Friday night worship", true),
];

// One timed block-out and one all-day, so both paths are visible.
const BLOCKOUTS: CalendarBlockout[] = [
  {
    id: "bo-1",
    block_date: "2026-08-05",
    end_date: "2026-08-05",
    start_time: "14:00",
    end_time: "16:00",
    reason: "Room re-carpeted",
    relocation_note: null,
  },
  {
    id: "bo-2",
    block_date: "2026-08-07",
    end_date: "2026-08-07",
    start_time: null,
    end_time: null,
    reason: "Staff retreat",
    relocation_note: "Chapel",
  },
];

export default function Preview8a() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="ffsa-screen">
      <div className="border-b border-ink bg-white px-5 pb-4 pt-5 md:px-8">
        <div className="masthead-context">Frame 8a · fixtures · dev only</div>
        <h1 className="masthead-title">The wall</h1>
      </div>
      <div className="px-5 py-6 md:px-8">
        <Wall anchorISO="2026-08-03" sets={SETS} seatTypes={SEATS} bands={BANDS} blockouts={BLOCKOUTS} />
      </div>
    </div>
  );
}
