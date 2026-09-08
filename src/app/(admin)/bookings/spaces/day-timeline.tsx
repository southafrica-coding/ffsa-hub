"use client";

// The spaces day timeline, built from frame 3c. Every venue is a lane, so a
// double-booked room reads at a glance.
//
// Structure, per the frame: a 230px resource column against a black hour
// header, hour columns as gridlines, and every booking an absolutely
// positioned block whose left/width are percentages of the visible day. Rows
// are VENUES, never bookings — that is what makes a clash a clash.
//
// Scope note: 3c drew spaces and vehicles on one grid. That was reversed by
// product decision on 2026-08-18 — vehicles are a rental process, not a
// timetable, so they have a portal instead of lanes. See the 3c section of
// docs/redesign/91-build-status-and-gaps.md.
//
// This file is a pure composition. It owns no data access, no permission rule
// and no approval logic: the page decides which venues exist and hands them
// over.
//
// Geometry comes from src/lib/bookings/timegrid.ts — the same vocabulary the
// spaces week/day grids use (blockWindow → minutes-of-day, packLanes →
// side-by-side clashes, computeHourRange → the visible window), rotated so
// hours run across and resources run down.

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { packLanes, nowMinutes } from "@/lib/bookings/timegrid";
import { bookingBlockStyle } from "./ui";

// The frame's block metrics. Rows grow only when bookings actually stack.
const BLOCK_H = 40;
const BLOCK_GAP = 4;
const ROW_PAD = 12;

/** One booking on the timeline. `window` is null for an all-day or untimed
 *  booking — every vehicle booking is one, the schema being date-only. */
export type TimelineItem = {
  id: string;
  title: string;
  href: string;
  status: string;
  timeLabel: string;
  window: { start: number; end: number } | null;
};

/** One lane of the grid — a venue. `meta` is the building, shown under the
 *  name where the column is wide enough to carry it. */
export type TimelineResource = {
  key: string;
  /** The venue this lane is, so a click on empty time can prefill a booking. */
  venueId?: string;
  name: string;
  meta?: string | null;
  color: string;
  /** True when the space is held — a request on it goes to a booking manager
   *  rather than confirming. An empty lane on a held space is not "yours to
   *  take", and saying only "Free" read as though it were. */
  byApproval?: boolean;
  items: TimelineItem[];
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Ids of items in one resource that overlap another — same resource, same
 *  clock. Strict overlap, so back-to-back bookings are not a clash. */
function clashesIn(resolved: { id: string; start: number; end: number }[]): Set<string> {
  const ids = new Set<string>();
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const a = resolved[i];
      const b = resolved[j];
      if (a.start < b.end && b.start < a.end) {
        ids.add(a.id);
        ids.add(b.id);
      }
    }
  }
  return ids;
}

/** 230px at the frame's width. A 230px column on a 375px screen would leave
 *  145px of actual day, so it narrows below md; the grid scrolls either way. */
const RES_COL = "w-[136px] shrink-0 md:w-[230px]";

export function DayTimeline({
  resources,
  startHour,
  endHour,
  isToday,
  canRequest = false,
  slotHref,
}: {
  resources: TimelineResource[];
  startHour: number;
  endHour: number;
  /** The "now" line is a lie on any other day — paging to next Tuesday must not
   *  draw a marker across it. */
  isToday: boolean;
  /** Whether the viewer may request a booking. When they cannot, a free lane
   *  just reads "Free" — inviting them to request something they can't is
   *  worse than saying nothing. */
  canRequest?: boolean;
  /** Where a click on empty time in a lane goes. Omitted for a viewer who
   *  can't book — empty time is then just empty, not a broken invitation. */
  slotHref?: (venueId: string, startMin: number, endMin: number) => string;
}) {
  // The marker is read after mount only: the server renders in the deploy
  // region's clock and the browser in the user's, and a day timeline is the one
  // place that mismatch would be visible.
  const [nowMin, setNowMin] = useState<number | null>(null);
  useEffect(() => setNowMin(isToday ? nowMinutes() : null), [isToday]);

  const minOf = startHour * 60;
  const maxOf = endHour * 60;
  const span = Math.max(60, maxOf - minOf);
  const hours: number[] = [];
  for (let h = startHour; h < endHour; h++) hours.push(h);

  const pct = (min: number) => ((clamp(min, minOf, maxOf) - minOf) / span) * 100;

  // Half-hour targets across the visible day. A booking started this way
  // defaults to an hour — long enough to be a real slot, short enough to edit.
  const slots: number[] = [];
  for (let m = minOf; m < maxOf; m += 30) slots.push(m);

  return (
    // Wider than a narrow viewport by design; it scrolls inside itself rather
    // than pushing the page sideways.
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        {/* Black hour header */}
        <div className="flex bg-ink">
          <div
            className={`sticky left-0 z-20 border-r border-[#2A2A26] bg-ink px-4 py-2.5 md:px-[22px] ${RES_COL}`}
          >
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-[#C5C2AE]">
              Resource
            </span>
          </div>
          {/* Hour labels are positioned by the same percentage as the blocks
              below, not by flex cells — border widths would otherwise drift the
              header a pixel per hour away from the gridlines. */}
          <div className="relative min-w-0 flex-1">
            {hours.map((h, i) => (
              <div
                key={h}
                className="absolute inset-y-0 flex items-center border-l border-[#2A2A26] pl-2"
                style={{
                  left: `${(i / hours.length) * 100}%`,
                  width: `${100 / hours.length}%`,
                }}
              >
                <span className="font-mono text-[9px] font-bold tabular-nums tracking-[0.14em] text-[#C5C2AE]">
                  {String(h).padStart(2, "0")}
                </span>
              </div>
            ))}
            {/* Header spacer — the row has no content of its own, so it needs a
                height to hold the absolutely positioned hour cells open. */}
            <div className="py-2.5">
              <span className="invisible font-mono text-[9px] leading-none">0</span>
            </div>
          </div>
        </div>

        {resources.map((res) => {
          // An all-day / untimed booking occupies the whole visible day, so it
          // packs into lanes alongside timed blocks rather than sitting in a
          // separate band — an all-day van out IS a clash with a same-day trip
          // on that van, and the point of this screen is that you can see it.
          const resolved = res.items.map((item) => ({
            item,
            start: item.window ? item.window.start : minOf,
            end: item.window ? item.window.end : maxOf,
          }));
          const clashIds = clashesIn(
            resolved.map((r) => ({ id: r.item.id, start: r.start, end: r.end }))
          );
          const packed = packLanes(resolved);
          const laneCount = packed.reduce((mx, p) => Math.max(mx, p.lanes), 1);
          const rowH = Math.max(
            64,
            ROW_PAD * 2 + laneCount * BLOCK_H + (laneCount - 1) * BLOCK_GAP
          );

          return (
            <div key={res.key} className="flex border-b border-rule">
              <div
                className={`sticky left-0 z-20 border-r border-ink bg-white px-4 py-3 md:px-[22px] ${RES_COL}`}
              >
                <div className="flex items-start gap-2">
                  <span
                    className="mt-[3px] h-2.5 w-2.5 shrink-0"
                    style={{ backgroundColor: res.color }}
                  />
                  <div className="min-w-0">
                    {/* Wraps rather than truncates: at 136px "Upstairs
                        Classroom" would otherwise read as "Upstairs Cl…". */}
                    <div className="text-[14px] font-bold leading-tight">{res.name}</div>
                    {/* The building is the first thing to go when the column
                        narrows to 136px — the venue name never is. */}
                    {res.meta && (
                      <div className="mt-0.5 hidden truncate font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--text-tertiary)] md:block">
                        {res.meta}
                      </div>
                    )}
                    {res.byApproval && (
                      <div className="mt-1 inline-flex items-center border border-ink px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.14em]">
                        By approval
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="relative min-w-0 flex-1 bg-white" style={{ height: rowH }}>
                {/* Hour gridlines — same cadence as the header cells. The first
                    one is the resource column's own border. */}
                {hours.map((h, i) =>
                  i === 0 ? null : (
                    <div
                      key={h}
                      className="absolute inset-y-0 border-l border-[color:var(--surface-4)]"
                      style={{ left: `${(i / hours.length) * 100}%` }}
                    />
                  )
                )}

                {nowMin != null && nowMin >= minOf && nowMin <= maxOf && (
                  <div
                    className="absolute inset-y-0 z-30 border-l-2 border-destructive"
                    style={{ left: `${pct(nowMin)}%` }}
                  />
                )}

                {packed.map((p) => {
                  const left = pct(p.start);
                  const width = Math.max(0, pct(p.end) - left);
                  const clash = clashIds.has(p.item.id);
                  const allDay = p.item.window == null;
                  const base = bookingBlockStyle(p.item.status);
                  return (
                    <Link
                      key={p.item.id}
                      href={p.item.href}
                      title={`${p.item.title} · ${p.item.timeLabel}`}
                      style={{
                        ...base,
                        // A clash overrides the status border: it is the one
                        // thing this screen exists to make impossible to miss.
                        border: clash ? "1px solid hsl(var(--destructive))" : base.border,
                        top: ROW_PAD + p.lane * (BLOCK_H + BLOCK_GAP),
                        height: BLOCK_H,
                        left: `${left}%`,
                        width: `calc(${width}% - 3px)`,
                        minWidth: 22,
                        borderLeft: `3px solid ${clash ? "hsl(var(--destructive))" : res.color}`,
                      }}
                      className="absolute z-10 flex items-center gap-1.5 overflow-hidden px-2 hover:z-40 md:px-3"
                    >
                      {clash && (
                        <AlertTriangle className="h-3 w-3 shrink-0 text-destructive" />
                      )}
                      {/* The title outranks the clock. A short booking is a
                          narrow block, and giving the time a far higher shrink
                          factor makes the time collapse first — otherwise a
                          07:30 block reads "07:30 – 09:00" with no clue what
                          it is. */}
                      <span className="min-w-0 grow basis-auto truncate text-[12.5px] font-bold leading-none">
                        {p.item.title}
                      </span>
                      <span className="min-w-0 shrink-[9999] truncate font-mono text-[9px] tabular-nums tracking-[0.08em] text-[color:var(--text-tertiary)]">
                        {allDay ? "ALL DAY" : p.item.timeLabel}
                      </span>
                    </Link>
                  );
                })}

                {/* Empty time is bookable: each half hour is its own target,
                    sitting behind the blocks above. */}
                {slotHref && res.venueId &&
                  slots.map((m, i) => (
                    <Link
                      key={m}
                      href={slotHref(res.venueId!, m, m + 60)}
                      aria-label={`Book ${res.name} from ${String(Math.floor(m / 60)).padStart(2, "0")}:${m % 60 === 0 ? "00" : "30"}`}
                      className="absolute inset-y-0 z-0 hover:bg-bone"
                      style={{
                        left: `${(i / slots.length) * 100}%`,
                        width: `${100 / slots.length}%`,
                      }}
                    />
                  ))}

                {res.items.length === 0 && (
                  <span className="pointer-events-none absolute left-3 top-1/2 z-0 -translate-y-1/2 font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--text-quiet)]">
                    {slotHref
                      ? "Free — click a time to book"
                      : res.byApproval && canRequest
                        ? "Free — request to book"
                        : "Free"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
