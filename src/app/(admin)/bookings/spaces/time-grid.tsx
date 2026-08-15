"use client";

import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { AlertTriangle } from "lucide-react";
import { packLanes } from "@/lib/bookings/timegrid";
import { timeRangeLabel } from "@/lib/bookings/dates";
import type { BookingWithRefs } from "@/services/bookings";
import { BookingPopover } from "./booking-popover";
import { bookingBlockStyle } from "./ui";

const HOUR_H = 46; // px per hour
const MIN_BLOCK = 16;

export type GridColumn = {
  key: string;
  label: string;
  sublabel?: string;
  href?: string;
  isToday?: boolean;
};

export function TimeGrid({
  columns,
  bookingsByColumn,
  windowOf,
  startHour,
  endHour,
  clashIds,
  colorOf,
  nowMin,
}: {
  columns: GridColumn[];
  bookingsByColumn: Map<string, BookingWithRefs[]>;
  windowOf: (b: BookingWithRefs) => { start: number; end: number } | null;
  startHour: number;
  endHour: number;
  clashIds: Set<string>;
  colorOf: (b: BookingWithRefs) => string;
  nowMin?: number | null;
}) {
  const hours: number[] = [];
  for (let h = startHour; h <= endHour; h++) hours.push(h);
  const gridHeight = (endHour - startHour) * HOUR_H;
  const minOf = startHour * 60;

  return (
    <div className="border border-ink bg-white">
      {/* Column header */}
      <div className="flex bg-ink">
        <div className="w-14 shrink-0" />
        {columns.map((col) => {
          const head = (
            <>
              <div className="truncate font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[#C5C2AE]">
                {col.label}
              </div>
              {col.sublabel && (
                <div
                  className={cn(
                    // No yellow here — the screen's one yellow band is the
                    // pending-requests strip. Today reads white, the rest grey.
                    "font-display text-[17px] font-black tabular-nums leading-none",
                    col.isToday ? "text-white" : "text-[#8C8A80]"
                  )}
                >
                  {col.sublabel}
                </div>
              )}
            </>
          );
          return (
            <div
              key={col.key}
              className="min-w-0 flex-1 border-l border-[#2A2A26] px-2 py-2 text-center"
            >
              {col.href ? (
                <Link href={col.href} className="block">
                  {head}
                </Link>
              ) : (
                head
              )}
            </div>
          );
        })}
      </div>

      {/* Scrollable grid body */}
      <div className="flex max-h-[68vh] overflow-y-auto">
        {/* Hour gutter */}
        <div className="relative w-14 shrink-0" style={{ height: gridHeight }}>
          {hours.map((h, i) => (
            <div
              key={h}
              className="absolute right-1.5 -translate-y-1/2 font-mono text-[9px] font-bold tabular-nums text-[color:var(--text-tertiary)]"
              style={{ top: i * HOUR_H }}
            >
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>

        {/* Columns */}
        {columns.map((col) => {
          const items = bookingsByColumn.get(col.key) ?? [];
          const timed: { item: BookingWithRefs; start: number; end: number }[] = [];
          const allDay: BookingWithRefs[] = [];
          for (const b of items) {
            const w = windowOf(b);
            if (w) timed.push({ item: b, start: w.start, end: w.end });
            else allDay.push(b);
          }
          const packed = packLanes(timed);

          return (
            <div
              key={col.key}
              className={cn(
                "relative min-w-0 flex-1 border-l border-rule",
                col.isToday && "bg-bone"
              )}
              style={{ height: gridHeight }}
            >
              {/* Hour gridlines */}
              {hours.map((h, i) =>
                i === 0 ? null : (
                  <div
                    key={h}
                    className="absolute inset-x-0 border-t border-rule"
                    style={{ top: i * HOUR_H }}
                  />
                )
              )}

              {/* Now line */}
              {col.isToday &&
                nowMin != null &&
                nowMin >= minOf &&
                nowMin <= endHour * 60 && (
                  <div
                    className="absolute inset-x-0 z-30 border-t border-destructive"
                    style={{ top: ((nowMin - minOf) / 60) * HOUR_H }}
                  >
                    <span className="absolute -left-0.5 -top-[3px] h-1.5 w-1.5 bg-destructive" />
                  </div>
                )}

              {/* All-day / untimed bookings */}
              {allDay.length > 0 && (
                <div className="absolute inset-x-1 top-1 z-20 space-y-0.5">
                  {allDay.map((b) => (
                    <BookingPopover key={b.id} booking={b}>
                      <button
                        type="button"
                        title={`${b.title} · all day`}
                        style={bookingBlockStyle(b.status)}
                        className="block w-full truncate px-1.5 py-0.5 text-left text-[10px] font-medium normal-case tracking-normal"
                      >
                        {b.title}
                      </button>
                    </BookingPopover>
                  ))}
                </div>
              )}

              {/* Timed blocks */}
              {packed.map((p) => {
                const top = ((p.start - minOf) / 60) * HOUR_H;
                const height = Math.max(MIN_BLOCK, ((p.end - p.start) / 60) * HOUR_H - 2);
                const widthPct = 100 / p.lanes;
                const leftPct = p.lane * widthPct;
                const clash = clashIds.has(p.item.id);
                return (
                  <BookingPopover key={p.item.id} booking={p.item}>
                    <button
                      type="button"
                      title={`${p.item.title} · ${timeRangeLabel(p.item.start_time, p.item.end_time)}`}
                      style={{
                        ...bookingBlockStyle(p.item.status),
                        top,
                        height,
                        left: `calc(${leftPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                        borderLeft: `3px solid ${colorOf(p.item)}`,
                      }}
                      className="absolute z-10 overflow-hidden px-1.5 py-0.5 text-left text-[10px] normal-case leading-tight tracking-normal hover:z-40"
                    >
                      <div className="flex items-center gap-0.5 font-semibold">
                        {clash && (
                          <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-destructive" />
                        )}
                        <span className="truncate">{p.item.title}</span>
                      </div>
                      {height > 26 && (
                        <div className="truncate font-mono text-[9px] tabular-nums text-[color:var(--text-tertiary)]">
                          {timeRangeLabel(p.item.start_time, p.item.end_time)}
                        </div>
                      )}
                    </button>
                  </BookingPopover>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
