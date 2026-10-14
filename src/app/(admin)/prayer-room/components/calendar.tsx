"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils/cn";
import {
  monthGridDays,
  isoMonth,
  isoDay,
  weekDays,
  weekdayShortFor,
  todayISO,
  humanDate,
  timeRangeLabel,
  WEEKDAY_HEADERS,
} from "@/lib/bookings/dates";
import { packLanes, computeHourRange, nowMinutes } from "@/lib/bookings/timegrid";
import { fullName, type Person } from "./helpers";

export interface CalendarSet {
  id: string;
  set_date: string;
  start_time: string;
  end_time: string;
  title: string | null;
  theme: string | null;
  status: string;
  relocation_note: string | null;
  owner: Person;
  slots: { status: string }[];
}

export interface CalendarBlockout {
  id: string;
  block_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  relocation_note: string | null;
  /** A Space Booking that still needs a block-out (staff-only, Manage acts on it). */
  pending?: boolean;
}

type ViewKind = "month" | "week" | "day" | "list";

const HOUR_H = 46; // px per hour
const MIN_BLOCK = 16;

// Hatched translucent red so blocked time reads clearly but the sets beneath stay visible.
const BLOCKOUT_FILL =
  "repeating-linear-gradient(45deg, hsl(0 72% 52% / 0.18), hsl(0 72% 52% / 0.18) 6px, hsl(0 72% 52% / 0.06) 6px, hsl(0 72% 52% / 0.06) 12px)";

function toMin(t: string | null): number {
  const m = (t || "").match(/^(\d{1,2}):(\d{2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0;
}
function winOf(s: CalendarSet): { start: number; end: number } {
  const start = toMin(s.start_time);
  return { start, end: Math.max(toMin(s.end_time), start + 15) };
}
// All-day block-out = no time window (whole day / week / range).
export const isAllDayBlockout = (b: CalendarBlockout) => !b.start_time || !b.end_time;
export function boWin(b: CalendarBlockout): { start: number; end: number } {
  const start = toMin(b.start_time || "");
  return { start, end: Math.max(toMin(b.end_time || ""), start + 15) };
}
const hhmm = (t: string | null) => (t || "").slice(0, 5);
const setTitle = (s: CalendarSet) => s.title || s.theme || "Devo set";
export const blockoutTip = (b: CalendarBlockout) => {
  const when = isAllDayBlockout(b) ? "all day" : `${hhmm(b.start_time)}–${hhmm(b.end_time)}`;
  if (b.pending) return `Pending block-out ${when}${b.reason ? ` — ${b.reason}` : ""} · booked in Space Bookings, block it out in Manage`;
  return `Blocked ${when}${b.reason ? ` — ${b.reason}` : ""}${b.relocation_note ? ` · sets → ${b.relocation_note}` : ""}`;
};

/** Every ISO date a block-out covers (block_date → end_date, capped for safety). */
function blockoutDays(b: CalendarBlockout): string[] {
  const end = b.end_date && b.end_date > b.block_date ? b.end_date : b.block_date;
  const out: string[] = [];
  const cur = new Date(`${b.block_date}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  let guard = 0;
  while (cur <= last && guard < 366) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
    guard++;
  }
  return out;
}

function chipStyle(status: string): CSSProperties {
  if (status === "cancelled") return { background: "hsl(22 8% 24% / 0.5)", color: "hsl(30 6% 58%)" };
  if (status === "completed") return { background: "hsl(142 45% 30% / 0.22)", color: "hsl(142 48% 76%)" };
  return { background: "hsl(42 95% 55% / 0.14)", color: "hsl(42 92% 74%)" }; // scheduled
}
function accentOf(s: CalendarSet): string {
  if (s.relocation_note) return "hsl(28 95% 58%)"; // orange = moved
  if (s.status === "completed") return "hsl(142 50% 45%)";
  if (s.status === "cancelled") return "hsl(30 6% 40%)";
  return "hsl(42 95% 58%)";
}
function fillLabel(s: CalendarSet): string | null {
  const total = s.slots.length;
  if (total === 0) return null;
  return `${s.slots.filter((x) => x.status === "filled").length}/${total}`;
}
function groupByDay(sets: CalendarSet[]): Map<string, CalendarSet[]> {
  const m = new Map<string, CalendarSet[]>();
  for (const s of sets) {
    const arr = m.get(s.set_date);
    if (arr) arr.push(s);
    else m.set(s.set_date, [s]);
  }
  return m;
}
// A multi-day block-out lands on every day it covers, so it shows on each of
// those days in the calendar.
export function groupBlockoutsByDay(blockouts: CalendarBlockout[]): Map<string, CalendarBlockout[]> {
  const m = new Map<string, CalendarBlockout[]>();
  for (const b of blockouts) {
    for (const day of blockoutDays(b)) {
      const arr = m.get(day);
      if (arr) arr.push(b);
      else m.set(day, [b]);
    }
  }
  return m;
}
// All-day block-outs sort first (null time), then timed ones by start.
const byBlockoutStart = (a: CalendarBlockout, b: CalendarBlockout) =>
  (a.start_time || "").localeCompare(b.start_time || "");

export function ScheduleCalendar({
  view,
  anchor,
  sets,
  blockouts,
  onSelect,
  onPickDay,
}: {
  view: ViewKind;
  anchor: string;
  sets: CalendarSet[];
  blockouts: CalendarBlockout[];
  onSelect: (id: string) => void;
  onPickDay: (iso: string) => void;
}) {
  if (view === "list") return <ListView sets={sets} blockouts={blockouts} onSelect={onSelect} />;
  if (view === "month")
    return <MonthView anchor={anchor} sets={sets} blockouts={blockouts} onSelect={onSelect} onPickDay={onPickDay} />;
  const days = view === "day" ? [anchor] : weekDays(anchor);
  return (
    <GridView days={days} sets={sets} blockouts={blockouts} onSelect={onSelect} onPickDay={view === "week" ? onPickDay : undefined} />
  );
}

function MonthView({
  anchor,
  sets,
  blockouts,
  onSelect,
  onPickDay,
}: {
  anchor: string;
  sets: CalendarSet[];
  blockouts: CalendarBlockout[];
  onSelect: (id: string) => void;
  onPickDay: (iso: string) => void;
}) {
  const year = parseInt(anchor.slice(0, 4), 10);
  const month = parseInt(anchor.slice(5, 7), 10);
  const days = monthGridDays(year, month);
  const today = todayISO();
  const byDay = groupByDay(sets);
  const blByDay = groupBlockoutsByDay(blockouts);

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-[0_2px_16px_rgba(0,0,0,0.35)]">
      <div className="grid grid-cols-7 border-b border-[hsl(22_8%_14%)] bg-[hsl(22_8%_10%)]">
        {WEEKDAY_HEADERS.map((h) => (
          <div key={h} className="px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            {h}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const inMonth = isoMonth(d) === month;
          const isToday = d === today;
          const daySets = (byDay.get(d) ?? []).sort((a, b) => a.start_time.localeCompare(b.start_time));
          const dayBlocks = (blByDay.get(d) ?? []).sort(byBlockoutStart);
          return (
            <div
              key={d}
              className={cn(
                "min-h-[96px] border-b border-l border-[hsl(22_8%_12%)] p-1",
                !inMonth && "bg-[hsl(22_8%_8%)]"
              )}
            >
              <button
                onClick={() => onPickDay(d)}
                className={cn(
                  "mb-1 block w-full px-1 text-right text-[11px] tabular-nums transition-colors hover:text-[hsl(42_95%_62%)]",
                  isToday ? "font-bold text-[hsl(42_95%_62%)]" : inMonth ? "text-foreground" : "text-muted-foreground/50"
                )}
              >
                {isoDay(d)}
              </button>
              <div className="space-y-0.5">
                {dayBlocks.map((b) => (
                  <div
                    key={b.id}
                    title={blockoutTip(b)}
                    className="truncate rounded px-1 py-0.5 text-left text-[10px] font-semibold"
                    style={{ background: "hsl(0 72% 52% / 0.18)", color: "hsl(0 85% 80%)", borderLeft: "2px solid hsl(0 80% 60%)" }}
                  >
                    {b.pending ? "⏳" : "🚧"} {isAllDayBlockout(b) ? `${b.pending ? "Pending" : "Blocked"} all day` : `${hhmm(b.start_time)} ${b.pending ? "Pending" : "Blocked"}`}
                  </div>
                ))}
                {daySets.slice(0, 3).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onSelect(s.id)}
                    title={`${hhmm(s.start_time)} ${setTitle(s)}`}
                    style={{ ...chipStyle(s.status), borderLeft: `2px solid ${accentOf(s)}` }}
                    className="block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-medium"
                  >
                    <span className="tabular-nums opacity-80">{hhmm(s.start_time)}</span> {setTitle(s)}
                  </button>
                ))}
                {daySets.length > 3 && (
                  <button onClick={() => onPickDay(d)} className="px-1 text-[10px] text-muted-foreground hover:text-foreground">
                    +{daySets.length - 3} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GridView({
  days,
  sets,
  blockouts,
  onSelect,
  onPickDay,
}: {
  days: string[];
  sets: CalendarSet[];
  blockouts: CalendarBlockout[];
  onSelect: (id: string) => void;
  onPickDay?: (iso: string) => void;
}) {
  const byDay = groupByDay(sets);
  const blByDay = groupBlockoutsByDay(blockouts);
  // Hour bounds must fit sets and TIMED block-out windows (all-day ones span the
  // whole column and shouldn't stretch the grid to 00:00).
  const { startHour, endHour } = computeHourRange([
    ...sets.map(winOf),
    ...blockouts.filter((b) => !isAllDayBlockout(b)).map(boWin),
  ]);
  const hours: number[] = [];
  for (let h = startHour; h <= endHour; h++) hours.push(h);
  const gridHeight = (endHour - startHour) * HOUR_H;
  const minOf = startHour * 60;
  const today = todayISO();
  const nowMin = nowMinutes();

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-[0_2px_16px_rgba(0,0,0,0.35)]">
      {/* Column header */}
      <div className="flex border-b border-[hsl(22_8%_14%)] bg-[hsl(22_8%_10%)]">
        <div className="w-14 shrink-0" />
        {days.map((d) => {
          const isToday = d === today;
          const head = (
            <>
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{weekdayShortFor(d)}</div>
              <div className={cn("text-sm font-semibold tabular-nums", isToday ? "text-[hsl(42_95%_62%)]" : "text-foreground")}>
                {isoDay(d)}
              </div>
            </>
          );
          return (
            <div
              key={d}
              className={cn(
                "min-w-0 flex-1 border-l border-[hsl(22_8%_14%)] px-2 py-2 text-center",
                isToday && "bg-[hsl(42_95%_55%/0.06)]"
              )}
            >
              {onPickDay ? (
                <button onClick={() => onPickDay(d)} className="block w-full transition-colors hover:text-[hsl(42_95%_62%)]">
                  {head}
                </button>
              ) : (
                head
              )}
            </div>
          );
        })}
      </div>

      {/* Scrollable body */}
      <div className="flex max-h-[68vh] overflow-y-auto">
        <div className="relative w-14 shrink-0" style={{ height: gridHeight }}>
          {hours.map((h, i) => (
            <div
              key={h}
              className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-[hsl(30_6%_40%)]"
              style={{ top: i * HOUR_H }}
            >
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>

        {days.map((d) => {
          const isToday = d === today;
          const items = byDay.get(d) ?? [];
          const packed = packLanes(items.map((s) => ({ item: s, ...winOf(s) })));
          const dayBlocks = blByDay.get(d) ?? [];
          return (
            <div
              key={d}
              className={cn("relative min-w-0 flex-1 border-l border-[hsl(22_8%_12%)]", isToday && "bg-[hsl(42_95%_55%/0.03)]")}
              style={{ height: gridHeight }}
            >
              {hours.map((h, i) =>
                i === 0 ? null : (
                  <div key={h} className="absolute inset-x-0 border-t border-[hsl(22_8%_11%)]" style={{ top: i * HOUR_H }} />
                )
              )}

              {isToday && nowMin >= minOf && nowMin <= endHour * 60 && (
                <div className="absolute inset-x-0 z-30 border-t border-[hsl(0_80%_60%)]" style={{ top: ((nowMin - minOf) / 60) * HOUR_H }}>
                  <span className="absolute -left-0.5 -top-[3px] h-1.5 w-1.5 rounded-full bg-[hsl(0_80%_60%)]" />
                </div>
              )}

              {/* Devo sets */}
              {packed.map((p) => {
                const top = ((p.start - minOf) / 60) * HOUR_H;
                const height = Math.max(MIN_BLOCK, ((p.end - p.start) / 60) * HOUR_H - 2);
                const widthPct = 100 / p.lanes;
                const leftPct = p.lane * widthPct;
                const s = p.item;
                const fill = fillLabel(s);
                return (
                  <button
                    key={s.id}
                    onClick={() => onSelect(s.id)}
                    title={`${setTitle(s)} · ${timeRangeLabel(s.start_time, s.end_time)}`}
                    style={{
                      ...chipStyle(s.status),
                      top,
                      height,
                      left: `calc(${leftPct}% + 2px)`,
                      width: `calc(${widthPct}% - 4px)`,
                      borderLeft: `2px solid ${accentOf(s)}`,
                    }}
                    className="absolute z-10 overflow-hidden rounded-md px-1.5 py-0.5 text-left text-[10px] leading-tight transition-all hover:z-40 hover:brightness-110"
                  >
                    <div className="truncate font-semibold">{setTitle(s)}</div>
                    {height > 26 && (
                      <div className="truncate tabular-nums opacity-75">
                        {hhmm(s.start_time)}–{hhmm(s.end_time)}
                        {fill ? ` · ${fill}` : ""}
                      </div>
                    )}
                    {s.relocation_note && height > 42 && <div className="truncate text-[9px] opacity-80">→ {s.relocation_note}</div>}
                  </button>
                );
              })}

              {/* Block-out overlay — sits ON TOP of any sets it covers but lets
                  clicks pass through to the sets beneath (pointer-events: none).
                  All-day block-outs span the full column; timed ones cover their
                  window. */}
              {dayBlocks.map((b) => {
                const allDay = isAllDayBlockout(b);
                const bs = allDay ? minOf : toMin(b.start_time);
                const be = allDay ? endHour * 60 : Math.max(toMin(b.end_time), bs + 15);
                const top = ((bs - minOf) / 60) * HOUR_H;
                const height = Math.max(MIN_BLOCK, ((be - bs) / 60) * HOUR_H);
                return (
                  <div
                    key={b.id}
                    title={blockoutTip(b)}
                    className="pointer-events-none absolute inset-x-0 z-20 overflow-hidden border-y border-dashed border-[hsl(0_78%_62%/0.8)]"
                    style={{ top, height, background: BLOCKOUT_FILL }}
                  >
                    <div className="truncate px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[hsl(0_85%_82%)]">
                      {b.pending ? "⏳ Pending block-out" : `🚧 ${allDay ? "Blocked all day" : "Blocked"}`}
                      {b.relocation_note ? ` → ${b.relocation_note}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ListView({
  sets,
  blockouts,
  onSelect,
}: {
  sets: CalendarSet[];
  blockouts: CalendarBlockout[];
  onSelect: (id: string) => void;
}) {
  const setsByDay = groupByDay(sets);
  const blByDay = groupBlockoutsByDay(blockouts);
  const dates = Array.from(new Set([...sets.map((s) => s.set_date), ...blByDay.keys()])).sort();

  if (dates.length === 0) {
    return <p className="rounded-xl border bg-card py-16 text-center text-muted-foreground">Nothing scheduled in this range.</p>;
  }

  return (
    <div className="space-y-4">
      {dates.map((date) => {
        const daySets = (setsByDay.get(date) ?? []).sort((a, b) => a.start_time.localeCompare(b.start_time));
        const dayBlocks = (blByDay.get(date) ?? []).sort(byBlockoutStart);
        return (
          <div key={date}>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{humanDate(date)}</div>
            <div className="space-y-1.5">
              {dayBlocks.map((b) => (
                <div
                  key={b.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                  style={{ borderColor: "hsl(0 72% 52% / 0.4)", background: "hsl(0 72% 52% / 0.08)" }}
                >
                  <span className="font-semibold text-[hsl(0_85%_80%)]">
                    {b.pending ? "⏳ Pending block-out" : "🚧 Blocked"} {isAllDayBlockout(b) ? "all day" : `${hhmm(b.start_time)}–${hhmm(b.end_time)}`}
                  </span>
                  {(b.reason || b.relocation_note) && (
                    <span className="truncate text-xs text-muted-foreground">
                      {b.reason || ""}
                      {b.relocation_note ? ` · sets → ${b.relocation_note}` : ""}
                    </span>
                  )}
                </div>
              ))}
              {daySets.map((s) => {
                const fill = fillLabel(s);
                return (
                  <button
                    key={s.id}
                    onClick={() => onSelect(s.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:border-primary/50 hover:bg-accent"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {setTitle(s)}
                        {s.status !== "scheduled" && <span className="ml-2 text-xs capitalize text-muted-foreground">{s.status}</span>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {hhmm(s.start_time)}–{hhmm(s.end_time)}
                        {s.owner ? ` · ${fullName(s.owner)}` : ""}
                        {s.relocation_note ? ` · → ${s.relocation_note}` : ""}
                      </div>
                    </div>
                    {fill && <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{fill}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
