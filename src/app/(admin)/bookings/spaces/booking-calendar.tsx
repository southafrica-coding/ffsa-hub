"use client";

import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { AlertTriangle, Plus } from "lucide-react";
import {
  monthGridDays,
  monthParam,
  WEEKDAY_HEADERS,
  isoMonth,
  isoDay,
  todayISO,
  expandBookingDays,
  timeLabel,
} from "@/lib/bookings/dates";
import type { BookingWithRefs, Venue } from "@/services/bookings";
import { BookingPopover } from "./booking-popover";
import { bookingBlockStyle } from "./ui";

const MAX_CHIPS = 3;

export function BookingCalendar({
  bookings,
  venues,
  clashIds,
  year,
  month,
  canCreate,
}: {
  bookings: BookingWithRefs[];
  venues: Venue[];
  clashIds: Set<string>;
  year: number;
  month: number;
  /** Whether the viewer may create a booking — hides the per-day "+". */
  canCreate: boolean;
}) {
  const days = monthGridDays(year, month);
  const today = todayISO();
  const venueColor = new Map(venues.map((v) => [v.id, v.color]));

  // Bucket bookings onto each day they cover.
  const byDay = new Map<string, BookingWithRefs[]>();
  for (const b of bookings) {
    for (const d of expandBookingDays(b)) {
      const arr = byDay.get(d);
      if (arr) arr.push(b);
      else byDay.set(d, [b]);
    }
  }

  return (
    <div className="border border-ink bg-white">
      {/* Weekday header */}
      <div className="grid grid-cols-7 bg-ink">
        {WEEKDAY_HEADERS.map((wd) => (
          <div
            key={wd}
            className="px-2 py-2.5 text-center font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[#C5C2AE]"
          >
            {wd}
          </div>
        ))}
      </div>

      {/* 6-week grid */}
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const inMonth = isoMonth(d) === month;
          const isToday = d === today;
          const isWeekend = i % 7 === 0 || i % 7 === 6;
          const dayBookings = byDay.get(d) ?? [];
          const shown = dayBookings.slice(0, MAX_CHIPS);
          const extra = dayBookings.length - shown.length;

          return (
            <div
              key={d}
              className={cn(
                "group min-h-[7rem] border-b border-r border-rule p-1.5 transition-colors",
                "[&:nth-child(7n)]:border-r-0",
                i >= 35 && "border-b-0",
                // Out-of-month and weekend cells sit back on bone; today is the
                // only cell that gets a black frame.
                !inMonth ? "bg-bone-2" : isWeekend ? "bg-bone" : "bg-white",
                isToday && "ring-1 ring-inset ring-ink"
              )}
            >
              <div className="mb-1 flex items-center justify-between px-0.5">
                <Link
                  href={`/bookings/spaces?view=day&date=${d}`}
                  title="Open day view"
                  className={cn(
                    "flex h-5 min-w-5 items-center justify-center px-1 font-display text-[13px] font-black tabular-nums leading-none",
                    !inMonth && "text-[color:var(--text-quiet)]",
                    inMonth && !isToday && "text-[color:var(--text-secondary)]",
                    isToday && "bg-ink text-white"
                  )}
                >
                  {isoDay(d)}
                </Link>
                <span className="relative flex h-4 w-5 items-center justify-center">
                  {dayBookings.length > 0 && (
                    <span className="font-mono text-[9px] font-bold tabular-nums text-[color:var(--text-tertiary)] transition-opacity group-hover:opacity-0">
                      {dayBookings.length}
                    </span>
                  )}
                  {canCreate && (
                    <Link
                      href={`/bookings/spaces/new?date=${d}`}
                      aria-label="New booking on this day"
                      className="absolute inset-0 flex items-center justify-center text-[color:var(--text-tertiary)] opacity-0 transition-all hover:text-ink group-hover:opacity-100"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </span>
              </div>

              <div className="space-y-0.5">
                {shown.map((b) => {
                  const clash = clashIds.has(b.id);
                  const color = venueColor.get(b.venue_id) ?? "#64748b";
                  const t = timeLabel(b.start_time);
                  return (
                    <BookingPopover key={`${b.id}-${d}`} booking={b}>
                      <button
                        type="button"
                        title={`${b.title} · ${b.venue?.name ?? ""}`}
                        style={bookingBlockStyle(b.status)}
                        className="flex w-full items-center gap-1 px-1.5 py-[3px] text-left text-[11px] font-normal normal-case leading-tight tracking-normal"
                      >
                        <span
                          className="h-3 w-[3px] shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        {clash && (
                          <AlertTriangle className="h-3 w-3 shrink-0 text-destructive" />
                        )}
                        <span className="truncate">
                          {t !== "—" && (
                            <span className="font-mono text-[10px] font-bold tabular-nums text-[color:var(--text-tertiary)]">
                              {t}{" "}
                            </span>
                          )}
                          {b.title}
                        </span>
                      </button>
                    </BookingPopover>
                  );
                })}
                {extra > 0 && (
                  <Link
                    href={`/bookings/spaces?view=list&month=${monthParam(year, month)}`}
                    className="mono-label block px-1.5 pt-0.5 transition-colors hover:text-ink"
                  >
                    +{extra} more
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
