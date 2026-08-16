"use client";

// Frame 3c: spaces AND vehicles on ONE day timeline, so a double-booked room
// or van is visible at a glance. This is a read-only COMPOSITION over the two
// subsystems — it owns no data access, no approval logic and no permission
// rule of its own. The hub page decides which halves exist; this file only
// draws whatever rows it is handed.
//
// Geometry is the same vocabulary as spaces/time-grid.tsx (blockWindow →
// minutes-of-day, packLanes → side-by-side clashes, computeHourRange → the
// visible window), rotated: hours run across, resources run down.

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { packLanes, nowMinutes } from "@/lib/bookings/timegrid";
import { bookingBlockStyle, ColorDot } from "./spaces/ui";

const RESOURCE_W = 230; // px — the recipe's resource column
const LANE_H = 24; // px per stacked block inside one resource row
const LANE_GAP = 3;

/** One booking on the timeline. `window` is null for an all-day / untimed
 *  booking — the row renders it across the full day rather than as a sliver. */
export type TimelineItem = {
  id: string;
  title: string;
  href: string;
  status: string;
  timeLabel: string;
  window: { start: number; end: number } | null;
};

/** One resource lane — a venue or a vehicle. Rows are resources, never bookings. */
export type TimelineRow = {
  key: string;
  label: string;
  meta?: string | null;
  color: string;
  items: TimelineItem[];
};

/** Spaces / Vehicles. A half the user cannot see is simply never passed in, so
 *  there is no empty heading and no error for them. */
export type TimelineGroup = {
  key: string;
  label: string;
  rows: TimelineRow[];
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Ids of items in one row that overlap another — same resource, same clock. */
function clashesIn(resolved: { id: string; start: number; end: number }[]): Set<string> {
  const ids = new Set<string>();
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const a = resolved[i];
      const b = resolved[j];
      // Strict overlap — back-to-back bookings are not a clash.
      if (a.start < b.end && b.start < a.end) {
        ids.add(a.id);
        ids.add(b.id);
      }
    }
  }
  return ids;
}

export function DayTimeline({
  groups,
  startHour,
  endHour,
}: {
  groups: TimelineGroup[];
  startHour: number;
  endHour: number;
}) {
  // The "now" marker is read after mount only: the server renders in the
  // deploy region's clock and the browser in the user's, and a day timeline is
  // the one place that mismatch would be visible.
  const [nowMin, setNowMin] = useState<number | null>(null);
  useEffect(() => setNowMin(nowMinutes()), []);

  const minOf = startHour * 60;
  const maxOf = endHour * 60;
  const span = Math.max(60, maxOf - minOf);
  const hours: number[] = [];
  for (let h = startHour; h < endHour; h++) hours.push(h);

  const pct = (min: number) => ((clamp(min, minOf, maxOf) - minOf) / span) * 100;

  return (
    // The grid is wider than a narrow viewport; it scrolls inside itself
    // rather than pushing the page sideways.
    <div className="overflow-x-auto">
      <div className="min-w-[860px]">
        {/* Hour header */}
        <div className="flex bg-ink">
          <div
            className="sticky left-0 z-20 shrink-0 border-r border-[#2A2A26] bg-ink px-3 py-2"
            style={{ width: RESOURCE_W }}
          >
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[#C5C2AE]">
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
                className="absolute inset-y-0 flex items-center justify-center border-l border-[#2A2A26]"
                style={{
                  left: `${(i / hours.length) * 100}%`,
                  width: `${100 / hours.length}%`,
                }}
              >
                <span className="font-mono text-[9px] font-bold tabular-nums tracking-[0.08em] text-[#8C8A80]">
                  {String(h).padStart(2, "0")}:00
                </span>
              </div>
            ))}
          </div>
        </div>

        {groups.map((group) => (
          <div key={group.key}>
            {/* Half heading. Only rendered for a half that actually has rows —
                a vehicles-only user never sees a bare "Spaces" strip. */}
            <div className="flex border-t border-rule bg-bone">
              <div
                className="sticky left-0 z-20 shrink-0 border-r border-rule bg-bone px-3 py-1.5"
                style={{ width: RESOURCE_W }}
              >
                <span className="mono-label">{group.label}</span>
              </div>
              <div className="min-w-0 flex-1" />
            </div>

            {group.rows.map((row) => {
              // An all-day / untimed booking occupies the whole visible day, so
              // it packs into lanes alongside timed blocks instead of sitting
              // in a separate band — an all-day van out IS a clash with a
              // same-day trip on that van.
              const resolved = row.items.map((item) => ({
                item,
                start: item.window ? item.window.start : minOf,
                end: item.window ? item.window.end : maxOf,
              }));
              const clashIds = clashesIn(
                resolved.map((r) => ({ id: r.item.id, start: r.start, end: r.end }))
              );
              const packed = packLanes(resolved);
              const laneCount = packed.reduce((mx, p) => Math.max(mx, p.lanes), 1);
              const rowH = laneCount * (LANE_H + LANE_GAP) + LANE_GAP;

              return (
                <div key={row.key} className="flex border-t border-rule">
                  <div
                    className="sticky left-0 z-20 shrink-0 border-r border-rule bg-white px-3 py-2"
                    style={{ width: RESOURCE_W }}
                  >
                    <div className="flex items-center gap-2">
                      <ColorDot color={row.color} />
                      <span className="truncate text-[13px] font-medium">{row.label}</span>
                    </div>
                    {row.meta && (
                      <div className="mt-0.5 truncate pl-[18px] font-mono text-[9px] uppercase tracking-[0.12em] text-[color:var(--text-tertiary)]">
                        {row.meta}
                      </div>
                    )}
                  </div>

                  <div
                    className="relative min-w-0 flex-1 bg-white"
                    style={{ height: rowH }}
                  >
                    {/* Hour gridlines — same cadence as the header cells. The
                        first one is the resource column's own border. */}
                    {hours.map((h, i) =>
                      i === 0 ? null : (
                        <div
                          key={h}
                          className="absolute inset-y-0 border-l border-rule"
                          style={{ left: `${(i / hours.length) * 100}%` }}
                        />
                      )
                    )}

                    {nowMin != null && nowMin >= minOf && nowMin <= maxOf && (
                      <div
                        className="absolute inset-y-0 z-30 border-l border-destructive"
                        style={{ left: `${pct(nowMin)}%` }}
                      />
                    )}

                    {packed.map((p) => {
                      const left = pct(p.start);
                      const width = Math.max(0, pct(p.end) - left);
                      const clash = clashIds.has(p.item.id);
                      const allDay = p.item.window == null;
                      return (
                        <Link
                          key={p.item.id}
                          href={p.item.href}
                          title={`${p.item.title} · ${p.item.timeLabel}`}
                          style={{
                            ...bookingBlockStyle(p.item.status),
                            top: LANE_GAP + p.lane * (LANE_H + LANE_GAP),
                            height: LANE_H,
                            left: `${left}%`,
                            width: `calc(${width}% - 2px)`,
                            minWidth: 12,
                            borderLeft: `3px solid ${row.color}`,
                          }}
                          className="absolute z-10 flex items-center gap-1 overflow-hidden px-1.5 text-[11px] leading-none hover:z-40"
                        >
                          {clash && (
                            <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-destructive" />
                          )}
                          <span className="truncate font-medium">{p.item.title}</span>
                          <span className="shrink-0 font-mono text-[9px] tabular-nums text-[color:var(--text-tertiary)]">
                            {allDay ? "ALL DAY" : p.item.timeLabel}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
