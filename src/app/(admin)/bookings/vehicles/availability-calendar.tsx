import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  monthGridDays,
  monthLabel,
  monthParam,
  shiftMonth,
  isoMonth,
  isoDay,
  todayISO,
  WEEKDAY_HEADERS,
} from "@/lib/bookings/dates";
import type { DayAvailability } from "@/services/vehicles";

/**
 * The fleet as availability, not as bookings — how many vans and cars are free
 * on each day of a month. This is the landing view for everyone in the Hub;
 * who booked what lives on the admin board instead.
 */
export function AvailabilityCalendar({
  availability,
  year,
  month,
  canRequest,
}: {
  availability: Map<string, DayAvailability>;
  year: number;
  month: number;
  /** Whether the viewer may request a vehicle — hides the per-day "+". */
  canRequest: boolean;
}) {
  const days = monthGridDays(year, month);
  const today = todayISO();
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);

  return (
    <div className="border border-ink bg-white">
      {/* Month nav */}
      <div className="flex items-center justify-between border-b border-ink bg-white px-4 py-3">
        <Link
          href={`/bookings/vehicles?month=${monthParam(prev.year, prev.month)}`}
          aria-label="Previous month"
          className="flex h-11 w-11 items-center justify-center border border-rule-strong bg-white hover:bg-bone md:h-8 md:w-8"
        >
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <div className="text-center">
          <div className="font-display text-[15px] font-black uppercase tracking-[0.04em]">
            {monthLabel(year, month)}
          </div>
          <div className="mono-label mt-0.5">Vehicles free per day</div>
        </div>
        <Link
          href={`/bookings/vehicles?month=${monthParam(next.year, next.month)}`}
          aria-label="Next month"
          className="flex h-11 w-11 items-center justify-center border border-rule-strong bg-white hover:bg-bone md:h-8 md:w-8"
        >
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      {/* Phone: one day per row. The 7-column grid leaves ~50px a cell. */}
      <div className="md:hidden">
        {days.filter((d) => isoMonth(d) === month).map((d) => {
          const isToday = d === today;
          const isPast = d < today;
          const a = availability.get(d);
          const requested = (a?.vansRequested ?? 0) + (a?.carsRequested ?? 0);
          const bookable = canRequest && !isPast;
          return (
            <div
              key={d}
              className={cn(
                "flex min-h-[52px] items-center gap-3 border-b border-rule px-4 py-2 last:border-b-0",
                isPast && "opacity-55"
              )}
            >
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center font-display text-[16px] font-black tabular-nums",
                  isToday ? "bg-ink text-white" : "text-ink"
                )}
              >
                {isoDay(d)}
              </span>
              <div className="min-w-0 flex-1 text-[13px]">
                {a && a.vanTotal > 0 && (
                  <span className="mr-3">
                    Vans {a.vans === 0 ? "full" : `${a.vans}/${a.vanTotal}`}
                  </span>
                )}
                {a && a.carTotal > 0 && (
                  <span>
                    Cars {a.cars === 0 ? "full" : `${a.cars}/${a.carTotal}`}
                  </span>
                )}
                {requested > 0 && (
                  <div className="mono-label mt-0.5">{requested} requested</div>
                )}
              </div>
              {bookable && (
                <Link
                  href={`/bookings/vehicles/new?date=${d}`}
                  className="flex h-11 shrink-0 items-center font-mono text-[10px] font-bold uppercase tracking-[0.12em]"
                >
                  Request
                </Link>
              )}
            </div>
          );
        })}
      </div>

      <div className="hidden md:block">
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
          const isPast = d < today;
          const isWeekend = i % 7 === 0 || i % 7 === 6;
          const a = availability.get(d);
          const requested = (a?.vansRequested ?? 0) + (a?.carsRequested ?? 0);
          // Nothing to book on a day already gone, and nothing to book before
          // the fleet exists — both make the "+" a dead end.
          const bookable = canRequest && !isPast;

          return (
            <div
              key={d}
              className={cn(
                "group relative min-h-[6.5rem] border-b border-r border-rule p-1.5 transition-colors",
                "[&:nth-child(7n)]:border-r-0",
                i >= 35 && "border-b-0",
                !inMonth ? "bg-bone-2" : isWeekend ? "bg-bone" : "bg-white",
                isPast && inMonth && "opacity-55",
                isToday && "ring-1 ring-inset ring-ink"
              )}
            >
              <div className="relative z-10 mb-1 flex items-center justify-between px-0.5">
                <span
                  className={cn(
                    "flex h-5 min-w-5 items-center justify-center px-1 font-display text-[13px] font-black tabular-nums leading-none",
                    !inMonth && "text-[color:var(--text-quiet)]",
                    inMonth && !isToday && "text-[color:var(--text-secondary)]",
                    isToday && "bg-ink text-white"
                  )}
                >
                  {isoDay(d)}
                </span>
                {bookable && (
                  <Link
                    href={`/bookings/vehicles/new?date=${d}`}
                    aria-label={`Request a vehicle on ${d}`}
                    className="relative z-10 flex h-4 w-5 items-center justify-center text-[color:var(--text-tertiary)] opacity-0 transition-all hover:text-ink group-hover:opacity-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>

              {/* The whole empty cell is the request target, behind the counts. */}
              {bookable && (
                <Link
                  href={`/bookings/vehicles/new?date=${d}`}
                  aria-label={`Request a vehicle on ${d}`}
                  className="absolute inset-0 z-0"
                />
              )}

              {a && (a.vanTotal > 0 || a.carTotal > 0) && (
                <div className="pointer-events-none relative z-10 space-y-px">
                  {a.vanTotal > 0 && (
                    <AvailRow
                      label="Vans"
                      free={a.vans}
                      total={a.vanTotal}
                      dim={!inMonth}
                    />
                  )}
                  {a.carTotal > 0 && (
                    <AvailRow
                      label="Cars"
                      free={a.cars}
                      total={a.carTotal}
                      dim={!inMonth}
                    />
                  )}
                  {requested > 0 && (
                    <div className="mono-label px-1 pt-0.5 leading-none">
                      {requested} requested
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-rule bg-bone px-4 py-2.5">
        <span className="mono-label">Free / fleet</span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 border border-ink bg-white" />
          <span className="text-[11px] text-[color:var(--text-secondary)]">
            Available
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 border border-rule-strong bg-bone-2" />
          <span className="text-[11px] text-[color:var(--text-secondary)]">
            Fully booked
          </span>
        </span>
        <span className="text-[11px] text-[color:var(--text-secondary)]">
          &ldquo;Requested&rdquo; means someone has asked but it isn&rsquo;t
          approved yet — those vehicles are still counted as free.
        </span>
      </div>
    </div>
  );
}

function AvailRow({
  label,
  free,
  total,
  dim,
}: {
  label: string;
  free: number;
  total: number;
  dim: boolean;
}) {
  const full = free === 0;
  return (
    <div
      className={cn(
        "flex items-center justify-between px-1 py-[2px] text-[11px] leading-tight",
        full ? "bg-bone-2 text-[color:var(--text-tertiary)]" : "text-ink",
        dim && "opacity-60"
      )}
    >
      <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[color:var(--text-tertiary)]">
        {label}
      </span>
      {full ? (
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em]">
          Full
        </span>
      ) : (
        <span className="font-semibold tabular-nums">
          {free}
          <span className="font-normal text-[color:var(--text-tertiary)]">
            /{total}
          </span>
        </span>
      )}
    </div>
  );
}
