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

type ViewKind = "month" | "week" | "day" | "list";

const HOUR_H = 46; // px per hour
const MIN_BLOCK = 16;

function toMin(t: string): number {
  const m = (t || "").match(/^(\d{1,2}):(\d{2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0;
}
function winOf(s: CalendarSet): { start: number; end: number } {
  const start = toMin(s.start_time);
  return { start, end: Math.max(toMin(s.end_time), start + 15) };
}
const hhmm = (t: string) => (t || "").slice(0, 5);
const setTitle = (s: CalendarSet) => s.title || s.theme || "Devo set";

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

export function ScheduleCalendar({
  view,
  anchor,
  sets,
  onSelect,
  onPickDay,
}: {
  view: ViewKind;
  anchor: string;
  sets: CalendarSet[];
  onSelect: (id: string) => void;
  onPickDay: (iso: string) => void;
}) {
  if (view === "list") return <ListView sets={sets} onSelect={onSelect} />;
  if (view === "month") return <MonthView anchor={anchor} sets={sets} onSelect={onSelect} onPickDay={onPickDay} />;
  const days = view === "day" ? [anchor] : weekDays(anchor);
  return <GridView days={days} sets={sets} onSelect={onSelect} onPickDay={view === "week" ? onPickDay : undefined} />;
}

function MonthView({
  anchor,
  sets,
  onSelect,
  onPickDay,
}: {
  anchor: string;
  sets: CalendarSet[];
  onSelect: (id: string) => void;
  onPickDay: (iso: string) => void;
}) {
  const year = parseInt(anchor.slice(0, 4), 10);
  const month = parseInt(anchor.slice(5, 7), 10);
  const days = monthGridDays(year, month);
  const today = todayISO();
  const byDay = groupByDay(sets);

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
  onSelect,
  onPickDay,
}: {
  days: string[];
  sets: CalendarSet[];
  onSelect: (id: string) => void;
  onPickDay?: (iso: string) => void;
}) {
  const byDay = groupByDay(sets);
  const { startHour, endHour } = computeHourRange(sets.map(winOf));
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
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ListView({ sets, onSelect }: { sets: CalendarSet[]; onSelect: (id: string) => void }) {
  const sorted = [...sets].sort(
    (a, b) => a.set_date.localeCompare(b.set_date) || a.start_time.localeCompare(b.start_time)
  );
  if (sorted.length === 0) {
    return <p className="rounded-xl border bg-card py-16 text-center text-muted-foreground">No devo sets in this range.</p>;
  }
  const groups: { date: string; items: CalendarSet[] }[] = [];
  for (const s of sorted) {
    const g = groups[groups.length - 1];
    if (g && g.date === s.set_date) g.items.push(s);
    else groups.push({ date: s.set_date, items: [s] });
  }
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.date}>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{humanDate(g.date)}</div>
          <div className="space-y-1.5">
            {g.items.map((s) => {
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
      ))}
    </div>
  );
}
