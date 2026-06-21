"use client";

import { TimeGrid } from "./time-grid";
import { blockWindow, computeHourRange, nowMinutes } from "@/lib/bookings/timegrid";
import { todayISO } from "@/lib/bookings/dates";
import type { BookingWithRefs, Venue } from "@/services/bookings";

function windowOf(b: BookingWithRefs) {
  // Multi-day bookings occupy the whole day → render as an all-day band.
  if (b.end_date && b.end_date > b.booking_date) return null;
  return blockWindow(b);
}

/** One column per venue, so a packed day shows which room is free when. */
export function DayView({
  bookings,
  venues,
  date,
  clashIds,
}: {
  bookings: BookingWithRefs[];
  venues: Venue[];
  date: string;
  clashIds: Set<string>;
}) {
  const isToday = date === todayISO();
  const columns = venues.map((v) => ({ key: v.id, label: v.name, isToday }));

  const byCol = new Map<string, BookingWithRefs[]>();
  for (const v of venues) byCol.set(v.id, []);
  for (const b of bookings) byCol.get(b.venue_id)?.push(b);

  const { startHour, endHour } = computeHourRange(bookings.map(windowOf));
  const venueColor = new Map(venues.map((v) => [v.id, v.color]));

  return (
    <TimeGrid
      columns={columns}
      bookingsByColumn={byCol}
      windowOf={windowOf}
      startHour={startHour}
      endHour={endHour}
      clashIds={clashIds}
      colorOf={(b) => venueColor.get(b.venue_id) ?? "#64748b"}
      nowMin={isToday ? nowMinutes() : null}
    />
  );
}
