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
import { statusChipStyle } from "@/lib/bookings/status";
import type { BookingWithRefs, Venue } from "@/services/bookings";

const MAX_CHIPS = 3;

export function BookingCalendar({
  bookings,
  venues,
  clashIds,
  year,
  month,
}: {
  bookings: BookingWithRefs[];
  venues: Venue[];
  clashIds: Set<string>;
  year: number;
  month: number;
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
    <div className="rounded-xl border bg-card overflow-hidden shadow-[0_2px_16px_rgba(0,0,0,0.35)]">
      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-[hsl(22_8%_14%)] bg-[hsl(22_8%_10%)]">
        {WEEKDAY_HEADERS.map((wd) => (
          <div
            key={wd}
            className="px-2 py-2 text-center text-[9px] font-bold uppercase tracking-[0.18em] text-[hsl(30_6%_42%)]"
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
              style={isToday ? { background: "hsl(42 95% 55% / 0.06)" } : undefined}
              className={cn(
                "group min-h-[7rem] border-b border-r border-[hsl(22_8%_12%)] p-1.5 transition-colors",
                "[&:nth-child(7n)]:border-r-0",
                i >= 35 && "border-b-0",
                !inMonth
                  ? "bg-[hsl(20_12%_4%)]"
                  : isWeekend
                    ? "bg-[hsl(20_12%_6%)]"
                    : "",
                isToday && "ring-1 ring-inset ring-primary/40"
              )}
            >
              <div className="mb-1 flex items-center justify-between px-0.5">
                <Link
                  href={`/bookings/spaces?view=day&date=${d}`}
                  title="Open day view"
                  className={cn(
                    "flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums transition-all hover:ring-1 hover:ring-primary/50",
                    !inMonth && "text-[hsl(30_6%_30%)]",
                    inMonth && !isToday && "text-[hsl(38_12%_72%)] hover:text-[hsl(42_95%_62%)]",
                    isToday && "bg-[hsl(42_95%_55%)] text-[#0D0B09]"
                  )}
                >
                  {isoDay(d)}
                </Link>
                <span className="relative flex h-4 w-5 items-center justify-center">
                  {dayBookings.length > 0 && (
                    <span className="text-[9px] font-semibold tabular-nums text-[hsl(30_6%_38%)] transition-opacity group-hover:opacity-0">
                      {dayBookings.length}
                    </span>
                  )}
                  <Link
                    href={`/bookings/spaces/new?date=${d}`}
                    aria-label="New booking on this day"
                    className="absolute inset-0 flex items-center justify-center rounded opacity-0 transition-all text-[hsl(30_6%_42%)] hover:text-[hsl(42_95%_62%)] group-hover:opacity-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Link>
                </span>
              </div>

              <div className="space-y-0.5">
                {shown.map((b) => {
                  const clash = clashIds.has(b.id);
                  const color = venueColor.get(b.venue_id) ?? "#64748b";
                  const t = timeLabel(b.start_time);
                  return (
                    <Link
                      key={`${b.id}-${d}`}
                      href={`/bookings/spaces/${b.id}`}
                      title={`${b.title} · ${b.venue?.name ?? ""}`}
                      style={statusChipStyle(b.status)}
                      className="flex items-center gap-1 rounded-[5px] px-1.5 py-[3px] text-[11px] leading-tight transition-all hover:brightness-125 hover:-translate-y-px"
                    >
                      <span
                        className="h-3 w-[3px] shrink-0 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      {clash && (
                        <AlertTriangle className="h-3 w-3 shrink-0 text-[hsl(0_70%_66%)]" />
                      )}
                      <span className="truncate">
                        {t !== "—" && (
                          <span className="font-semibold tabular-nums opacity-70">
                            {t}{" "}
                          </span>
                        )}
                        {b.title}
                      </span>
                    </Link>
                  );
                })}
                {extra > 0 && (
                  <Link
                    href={`/bookings/spaces?view=list&month=${monthParam(year, month)}`}
                    className="block px-1.5 text-[10px] font-semibold uppercase tracking-wide text-[hsl(30_6%_42%)] transition-colors hover:text-[hsl(42_95%_60%)]"
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
