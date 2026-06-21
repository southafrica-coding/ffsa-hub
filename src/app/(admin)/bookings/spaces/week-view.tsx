"use client";

import { TimeGrid } from "./time-grid";
import { blockWindow, computeHourRange, nowMinutes } from "@/lib/bookings/timegrid";
import {
  weekDays,
  weekdayShortFor,
  isoDay,
  todayISO,
  expandBookingDays,
} from "@/lib/bookings/dates";
import type { BookingWithRefs, Venue } from "@/services/bookings";

function windowOf(b: BookingWithRefs) {
  if (b.end_date && b.end_date > b.booking_date) return null;
  return blockWindow(b);
}

/** One column per day of the week; blocks coloured by venue. */
export function WeekView({
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
  const days = weekDays(date);
  const today = todayISO();
  const columns = days.map((d) => ({
    key: d,
    label: weekdayShortFor(d),
    sublabel: String(isoDay(d)),
    href: `/bookings/spaces?view=day&date=${d}`,
    isToday: d === today,
  }));

  const byCol = new Map<string, BookingWithRefs[]>();
  for (const d of days) byCol.set(d, []);
  for (const b of bookings) {
    for (const d of expandBookingDays(b)) byCol.get(d)?.push(b);
  }

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
      nowMin={nowMinutes()}
    />
  );
}
