"use client";

/**
 * The PRACTICE tab — design frames 36a (desktop) and 36e (phone).
 *
 * 36a is "the afternoon of the wall, shown larger": 14:00–20:00 at a scale
 * where each 30-minute practice row can carry its seven squares AND the names.
 * The ordinary sets and NIGHT are drawn for context, so practice reads as a
 * lane between them rather than as another set. The main wall carries the
 * same lane in compact form (see PracticeLane in wall.tsx).
 *
 * 36e is the same data as day tabs on a phone: three rows, seven station
 * buttons and a full-band button each, every target at least 48px.
 *
 * Practice is not coverage, and nothing here counts it as such.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { shiftDays, weekRangeLabel } from "@/lib/bookings/dates";
import { closureCovering } from "@/lib/prayer-room/room-closure";
import {
  PLAIN_BUTTON,
  bookingNames,
  hhmm,
  isClosedDay,
  practiceRows,
  practisingPhrase,
  rowState,
  sastNow,
  shortDayLabel,
  toMin,
  type PracticeBooking,
  type PracticeWeek,
  type RowState,
} from "@/lib/prayer-room/practice";
import PrayerRoomChrome, { type TabDef, type TabKey } from "./chrome";
import PracticeDrawers, { type PracticeTarget } from "./practice-drawers";
import type { Band } from "./wall";
import type { CalendarSet } from "./calendar";

/** Loads one practice week. Shared by this tab and the main wall's lane. */
export function usePracticeWeek(anchor: string) {
  const [week, setWeek] = useState<PracticeWeek | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/prayer-room/practice?week=${anchor}`);
      // A database without migration 224 answers with an error; the wall then
      // simply has no practice lane rather than a broken screen.
      setWeek(res.ok ? await res.json() : null);
    } catch {
      setWeek(null);
    }
  }, [anchor]);
  useEffect(() => {
    load();
  }, [load]);
  return { week, reload: load };
}

/** The names a row shows, in station order: "Sample · Person · Sample +2", you as "You". */
export function rowNames(row: RowState, week: PracticeWeek, userId: string): { text: string; mine: boolean } {
  let mine = false;
  const names = week.stations
    .filter((s) => row.byStation.has(s.id))
    .map((s) => {
      const b = row.byStation.get(s.id)!;
      if (b.booked_by === userId || b.people.some((p) => p.user_id === userId)) {
        mine = true;
        return "You";
      }
      return bookingNames(b);
    });
  return { text: names.join(" · "), mine };
}

/** A band's block starts at its own first row and spans the rest. */
function bandsOn(week: PracticeWeek, date: string): PracticeBooking[] {
  return week.bookings.filter((b) => b.kind === "band" && b.practice_date === date);
}

const P_START = 14 * 60;
const PX = 1.3;
const y = (m: number) => (m - P_START) * PX;

function dayTone(week: PracticeWeek, iso: string) {
  const today = week.now.slice(0, 10);
  const closed = isClosedDay(week.settings, iso);
  if (iso === today) return { sub: "TODAY", today: true, past: false, closed };
  if (closed) return { sub: week.settings.closed_label.toUpperCase(), today: false, past: iso < today, closed };
  if (iso < today) return { sub: "DONE", today: false, past: true, closed };
  if (week.now < week.opensAt) return { sub: `OPENS ${shortDayLabel(week.opensAt).slice(0, 3)}`, today: false, past: false, closed };
  return { sub: "OPEN", today: false, past: false, closed };
}

/* ── 36a · the afternoon, larger ───────────────────── */

export function AfternoonWall({
  week,
  sets,
  bands,
  userId,
  onOpen,
}: {
  week: PracticeWeek;
  sets: CalendarSet[];
  bands: Band[];
  userId: string;
  onOpen: (t: PracticeTarget) => void;
}) {
  const { settings, stations } = week;
  const laneStart = toMin(settings.start_time);
  const laneEnd = toMin(settings.end_time);
  const rows = practiceRows(settings);

  // The axis runs to the end of whatever curated band follows practice
  // (NIGHT, 17:30–20:00), and never shorter than 20:00.
  const named = bands.filter((b) => b.band_name && toMin(b.end_time) > P_START);
  const axisEnd = Math.max(20 * 60, ...named.map((b) => toMin(b.end_time)));
  const height = y(axisEnd);
  const hours: number[] = [];
  for (let h = P_START; h <= axisEnd; h += 60) hours.push(h);

  const gutterBands = useMemo(() => {
    const g = new Map<string, { name: string; start: number; end: number }>();
    for (const b of named) {
      const prev = g.get(b.band_name!);
      const s = toMin(b.start_time);
      const e = toMin(b.end_time);
      g.set(b.band_name!, { name: b.band_name!, start: prev ? Math.min(prev.start, s) : s, end: prev ? Math.max(prev.end, e) : e });
    }
    return [...g.values()];
  }, [named]);
  const inBand = (s: number, e: number) => gutterBands.some((b) => s < b.end && e > b.start);

  return (
    <div className="overflow-hidden border border-ink bg-white">
      <div className="grid grid-cols-[120px_repeat(5,1fr)] border-b border-ink">
        <span />
        {week.days.map((iso) => {
          const t = dayTone(week, iso);
          return (
            <div key={iso} className={cn("border-l border-rule px-3 py-[9px]", t.today ? "bg-ink" : "bg-white")}>
              <div
                className={cn(
                  "font-mono text-[9.5px] font-bold tracking-[0.12em]",
                  t.today ? "text-white" : t.past ? "text-[color:var(--text-quiet)]" : "text-ink"
                )}
              >
                {shortDayLabel(iso)}
              </div>
              <div
                className={cn(
                  "mt-[3px] font-mono text-[8.5px] font-bold tracking-[0.1em]",
                  t.today ? "text-yellow" : t.closed ? "text-amber" : "text-[color:var(--text-quiet)]"
                )}
              >
                {t.sub}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-[120px_repeat(5,1fr)]">
        {/* gutter */}
        <div className="relative" style={{ height }}>
          {hours.map((h) => (
            <span
              key={h}
              className="absolute right-3 -translate-y-px font-mono text-[8.5px] text-[#B5B1A3]"
              style={{ top: y(h) }}
            >
              {hhmm(h)}
            </span>
          ))}
          <div
            className="absolute inset-x-0 flex flex-col gap-[5px] border-y border-ink bg-bone px-3 py-[9px]"
            style={{ top: y(laneStart), height: (laneEnd - laneStart) * PX }}
          >
            <span className="font-display text-[21px] font-black leading-[0.9] text-ink">PRACTICE</span>
            <span className="font-mono text-[8.5px] font-bold tracking-[0.08em] text-[color:var(--text-muted)]">
              {settings.start_time} – {settings.end_time}
            </span>
            <span className="mt-auto font-mono text-[7.5px] font-bold leading-normal tracking-[0.08em] text-[color:var(--text-tertiary)]">
              {stations.slice(0, 4).map((s) => s.short_label).join(" ")}
              <br />
              {stations.slice(4).map((s) => s.short_label).join(" ")}
            </span>
          </div>
          {gutterBands
            .filter((b) => b.start >= laneStart)
            .map((b) => (
              <div
                key={b.name}
                className="absolute inset-x-0 flex flex-col gap-[5px] bg-ink px-3 py-[9px]"
                style={{ top: y(b.start), height: (b.end - b.start) * PX }}
              >
                <span className="font-display text-[21px] font-black leading-[0.9] text-white">{b.name}</span>
                <span className="font-mono text-[8.5px] font-bold tracking-[0.08em] text-yellow">
                  {hhmm(b.start)} – {hhmm(b.end)}
                </span>
              </div>
            ))}
        </div>

        {week.days.map((iso) => {
          const closed = isClosedDay(settings, iso);
          const daySets = sets.filter(
            (s) =>
              s.set_date === iso &&
              s.status !== "cancelled" &&
              toMin(s.end_time) > P_START &&
              toMin(s.start_time) < axisEnd
          );
          const dayBands = bandsOn(week, iso);
          return (
            <div key={iso} className="relative overflow-hidden border-l border-rule" style={{ height }}>
              {hours.map((h) => (
                <span key={h} className="absolute inset-x-0 h-px bg-[var(--surface-hover)]" style={{ top: y(h) }} />
              ))}
              <span
                className="absolute inset-x-0 border-y border-ink bg-bone"
                style={{ top: y(laneStart), height: (laneEnd - laneStart) * PX }}
              />
              {gutterBands
                .filter((b) => b.start >= laneStart)
                .map((b) => (
                  <span
                    key={b.name}
                    className="absolute inset-x-0 border-y-2 border-ink"
                    style={{ top: y(b.start), height: (b.end - b.start) * PX }}
                  />
                ))}

              {daySets.map((s) => {
                const a = Math.max(toMin(s.start_time), P_START);
                const b = Math.min(toMin(s.end_time), axisEnd);
                const curated = inBand(a, b);
                return (
                  <div key={s.id} className="absolute inset-x-1 py-[1.5px]" style={{ top: y(a), height: (b - a) * PX }}>
                    <div
                      className={cn(
                        "flex h-full flex-col gap-[3px] overflow-hidden px-2.5 py-[7px]",
                        curated ? "border-2 border-ink bg-yellow" : "border border-rule bg-bone-2"
                      )}
                    >
                      <span className="font-mono text-[9.5px] font-bold text-ink">
                        {hhmm(a)} – {hhmm(b)}
                      </span>
                      <span className="truncate text-[12.5px] font-bold leading-tight text-ink">
                        {s.title || s.theme || "Devo set"}
                      </span>
                    </div>
                  </div>
                );
              })}

              {closed ? (
                <div
                  className="absolute inset-x-1 py-[3px]"
                  style={{ top: y(laneStart), height: (laneEnd - laneStart) * PX }}
                >
                  <div
                    className="flex h-full flex-col items-center justify-center gap-1 border border-rule-strong text-center"
                    style={{ background: "repeating-linear-gradient(45deg,#E7E4D9 0 4px,#F8F7F2 4px 9px)" }}
                  >
                    <span className="bg-[var(--surface-hover)] px-1.5 py-0.5 font-display text-[17px] font-black uppercase leading-none text-[color:var(--text-secondary)]">
                      {settings.closed_label}
                    </span>
                    <span className="bg-[var(--surface-hover)] px-1.5 py-0.5 font-mono text-[8.5px] font-bold tracking-[0.12em] text-[color:var(--text-muted)]">
                      NO PRACTICE TODAY
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  {rows.map((r) => {
                    const st = rowState(week.bookings, stations, iso, r.start, r.end);
                    if (st.band) return null; // drawn once, below
                    const shut = closureCovering(week.closures, iso, r.start, r.end);
                    const { text, mine } = rowNames(st, week, userId);
                    const taken = st.byStation.size;
                    if (shut && taken === 0) {
                      return (
                        <div
                          key={r.start}
                          title={shut.label}
                          className="absolute inset-x-1 py-0.5"
                          style={{ top: y(r.start), height: (r.end - r.start) * PX }}
                        >
                          <div className="flex h-full items-center gap-[7px] overflow-hidden border border-rule-strong bg-bone-3 px-2">
                            <span className="font-mono text-[9px] font-bold text-[color:var(--text-muted)]">{hhmm(r.start)}</span>
                            <span className="truncate font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-[color:var(--text-muted)]">
                              {shut.label}
                            </span>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <button
                        key={r.start}
                        type="button"
                        onClick={() => onOpen({ kind: "row", date: iso, start: r.start })}
                        className={cn("absolute inset-x-1 py-0.5 text-left", PLAIN_BUTTON)}
                        style={{ top: y(r.start), height: (r.end - r.start) * PX }}
                      >
                        <div
                          className={cn(
                            "flex h-full flex-col justify-center gap-[3px] overflow-hidden px-2 py-1 hover:border-ink",
                            shut ? "border border-rule-strong bg-bone-3" : "bg-white",
                            mine ? "border-[1.5px] border-ink" : !shut && "border border-rule-strong"
                          )}
                        >
                          <div className="flex items-center gap-[7px]">
                            <span className="font-mono text-[9px] font-bold text-ink">{hhmm(r.start)}</span>
                            <Squares stations={week.stations.map((s) => st.byStation.has(s.id))} />
                            <span className="flex-1" />
                            <span
                              className={cn(
                                "font-mono text-[8px] font-bold tracking-[0.08em]",
                                taken ? "text-[color:var(--text-muted)]" : "text-grass"
                              )}
                            >
                              {shut ? shut.label : `${stations.length - taken} OPEN`}
                            </span>
                          </div>
                          <div
                            className={cn(
                              "truncate text-[10.5px]",
                              mine ? "font-bold" : "font-normal",
                              text ? "text-[color:var(--text-strong)]" : "text-[color:var(--text-quiet)]"
                            )}
                          >
                            {text || "Nobody yet"}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {dayBands.map((b) => {
                    const a = toMin(b.start_time);
                    const e = toMin(b.end_time);
                    const shut = closureCovering(week.closures, iso, a, e);
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => onOpen({ kind: "row", date: iso, start: a })}
                        className={cn("absolute inset-x-1 py-0.5 text-left", PLAIN_BUTTON)}
                        style={{ top: y(a), height: (e - a) * PX }}
                      >
                        <div
                          className={cn(
                            "flex h-full flex-col justify-center gap-[3px] overflow-hidden border-2 px-2 py-1",
                            shut ? "border-rule-strong bg-bone-3" : "border-ink bg-white"
                          )}
                        >
                          <div className="flex items-center gap-[7px]">
                            <span className="font-mono text-[9px] font-bold text-ink">
                              {hhmm(a)} – {hhmm(e)}
                            </span>
                            <Squares stations={week.stations.map(() => true)} />
                            <span className="flex-1" />
                            <span className="font-mono text-[8px] font-bold tracking-[0.08em] text-ink">
                              {shut ? shut.label : "FULL BAND"}
                            </span>
                          </div>
                          <div className="truncate text-[10.5px] font-bold text-ink">{b.band_name}</div>
                        </div>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** DR KY EL CJ AC BS VX — black when taken. */
export function Squares({ stations, size = 8 }: { stations: boolean[]; size?: number }) {
  return (
    <span className="flex gap-0.5">
      {stations.map((taken, i) => (
        <span
          key={i}
          className={cn("box-border border", taken ? "border-ink bg-ink" : "border-rule-strong bg-white")}
          style={{ width: size, height: size }}
        />
      ))}
    </span>
  );
}

/* ── 36e · on a phone ─────────────────────────────── */

export function PhonePractice({
  week,
  userId,
  onOpen,
}: {
  week: PracticeWeek;
  userId: string;
  onOpen: (t: PracticeTarget) => void;
}) {
  const { settings, stations } = week;
  const today = week.now.slice(0, 10);
  const firstOpen =
    week.days.find((d) => d >= today && !isClosedDay(settings, d)) ??
    week.days.find((d) => !isClosedDay(settings, d)) ??
    week.days[0];
  const [day, setDay] = useState(firstOpen);
  useEffect(() => setDay(firstOpen), [firstOpen]);

  const closed = isClosedDay(settings, day);
  const rows = practiceRows(settings);

  return (
    <div className="border border-ink bg-white">
      <div className="flex border-b border-ink">
        {week.days.map((iso) => {
          const shut = isClosedDay(settings, iso);
          const on = iso === day;
          const past = iso < today;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => setDay(iso)}
              className={cn(
                "flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 border-r border-bone-3",
                on ? "bg-ink" : "bg-white"
              )}
            >
              <span
                className={cn(
                  "font-mono text-[9.5px] font-bold tracking-[0.1em]",
                  on ? "text-white" : shut || past ? "text-[#B4B0A2]" : "text-ink",
                  shut && "line-through"
                )}
              >
                {shortDayLabel(iso).slice(0, 3)}
              </span>
              <span
                className={cn(
                  "font-display text-[16px] font-black leading-none",
                  on ? "text-white" : shut || past ? "text-[#B4B0A2]" : "text-ink"
                )}
              >
                {iso.slice(8, 10)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3.5 px-4 py-4">
        {closed ? (
          <div
            className="flex min-h-[140px] flex-col items-center justify-center gap-1 border border-rule-strong text-center"
            style={{ background: "repeating-linear-gradient(45deg,#E7E4D9 0 4px,#F8F7F2 4px 9px)" }}
          >
            <span className="bg-[var(--surface-hover)] px-1.5 py-0.5 font-display text-[19px] font-black uppercase leading-none text-[color:var(--text-secondary)]">
              {settings.closed_label}
            </span>
            <span className="bg-[var(--surface-hover)] px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.12em] text-[color:var(--text-muted)]">
              NO PRACTICE TODAY
            </span>
          </div>
        ) : (
          rows.map((r) => {
            const st = rowState(week.bookings, stations, day, r.start, r.end);
            const shut = closureCovering(week.closures, day, r.start, r.end);
            return (
              <div key={r.start} className="border border-ink">
                <div
                  className={cn(
                    "flex items-baseline justify-between border-b border-ink px-3 py-2.5",
                    shut ? "bg-bone-3" : "bg-bone"
                  )}
                >
                  <span className="font-display text-[19px] font-black leading-none tabular-nums text-ink">
                    {hhmm(r.start)} – {hhmm(r.end)}
                  </span>
                  <span className="font-mono text-[9px] font-bold tracking-[0.1em] text-[color:var(--text-muted)]">
                    {shut ? shut.label : st.band ? "FULL BAND" : `${st.open} OF ${stations.length} OPEN`}
                  </span>
                </div>
                {st.band ? (
                  <button
                    type="button"
                    onClick={() => onOpen({ kind: "row", date: day, start: r.start })}
                    className={cn(
                      "block min-h-[48px] w-full px-3 py-3 text-left",
                      PLAIN_BUTTON,
                      shut && "bg-bone-3"
                    )}
                  >
                    <div className="font-display text-[18px] font-black uppercase leading-none text-ink">
                      {st.band.band_name}
                    </div>
                    <div className="mt-1 font-mono text-[9px] font-bold tracking-[0.1em] text-[color:var(--text-tertiary)]">
                      THE WHOLE ROOM · {st.band.start_time} – {st.band.end_time}
                    </div>
                  </button>
                ) : (
                  <div className="grid grid-cols-4 gap-1 p-2">
                    {stations.map((s) => {
                      const b = st.byStation.get(s.id);
                      const mine = !!b && (b.booked_by === userId || b.people.some((p) => p.user_id === userId));
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            if (shut && !b) {
                              toast(shut.label);
                              return;
                            }
                            onOpen({ kind: "row", date: day, start: r.start, stationId: b ? undefined : s.id });
                          }}
                          className={cn(
                            PLAIN_BUTTON,
                            "flex min-h-[48px] flex-col items-center justify-center gap-0.5 p-1",
                            shut && !b
                              ? "border border-rule-strong bg-bone-3 text-[color:var(--text-muted)]"
                              : b
                                ? cn("bg-bone", mine ? "border-[1.5px] border-ink" : "border border-bone-3")
                                : "border border-ink bg-white"
                          )}
                        >
                          <span
                            className={cn(
                              "font-mono text-[9px] font-bold tracking-[0.08em]",
                              b ? "text-[color:var(--text-quiet)]" : "text-ink"
                            )}
                          >
                            {s.short_label}
                          </span>
                          <span
                            className={cn(
                              "max-w-full truncate text-[10.5px]",
                              b
                                ? mine
                                  ? "font-bold text-ink"
                                  : "text-[color:var(--text-muted)]"
                                : shut
                                  ? "text-[color:var(--text-muted)]"
                                  : "text-grass"
                            )}
                          >
                            {b ? (mine ? "You" : bookingNames(b)) : shut ? "Closed" : "Open"}
                          </span>
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      aria-disabled={!!shut || st.people > 0}
                      onClick={() =>
                        shut
                          ? toast(shut.label)
                          : st.people > 0
                            ? toast(`${practisingPhrase(st.people)}.`, {
                                description: "A band can only book an empty row. Only an admin can move people.",
                              })
                            : onOpen({ kind: "band", date: day, start: r.start })
                      }
                      className={cn(
                        "flex min-h-[48px] items-center justify-center border border-dashed border-rule-strong text-center font-mono text-[8.5px] font-bold leading-tight tracking-[0.06em]",
                        shut || st.people > 0 ? "text-rule-strong" : "text-ink"
                      )}
                    >
                      FULL
                      <br />
                      BAND
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}

        <div className="flex items-center justify-between gap-2.5 border border-rule bg-bone px-3.5 py-3">
          <span className="text-[13px] text-[color:var(--text-strong)]">
            {week.now < week.opensAt ? "This week opens on Sunday" : "Next week opens on Sunday"}
          </span>
          <span className="font-mono text-[9px] font-bold tracking-[0.1em] text-ink">
            {shortDayLabel(week.now < week.opensAt ? week.opensAt : week.nextOpensAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── the tab ──────────────────────────────────────── */

export default function PracticeView({
  userId,
  tabs,
  active,
  onTabChange,
}: {
  userId: string;
  tabs: TabDef[];
  active: TabKey;
  onTabChange: (key: TabKey) => void;
}) {
  const [anchor, setAnchor] = useState(() => sastNow().slice(0, 10));
  const { week, reload } = usePracticeWeek(anchor);
  const [sets, setSets] = useState<CalendarSet[]>([]);
  const [bands, setBands] = useState<Band[]>([]);
  const [target, setTarget] = useState<PracticeTarget>(null);

  useEffect(() => {
    if (!week) return;
    let cancelled = false;
    fetch(`/api/prayer-room/sets?dateFrom=${week.days[0]}&dateTo=${week.days[4]}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => !cancelled && setSets(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [week]);

  useEffect(() => {
    fetch("/api/prayer-room/wall-meta")
      .then((r) => (r.ok ? r.json() : { bands: [] }))
      .then((d) => setBands(d.bands ?? []))
      .catch(() => {});
  }, []);

  const label = weekRangeLabel(anchor).toUpperCase();
  const opens = week ? (week.now < week.opensAt ? week.opensAt : week.nextOpensAt) : null;
  const context = [label, week && week.now < week.opensAt ? `OPENS ${shortDayLabel(week.opensAt)}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div>
      <PrayerRoomChrome context={context} tabs={tabs} active={active} onChange={onTabChange} />

      <div className="flex flex-wrap items-center gap-2 border-b border-rule bg-bone px-5 py-3 md:px-8">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setAnchor(shiftDays(anchor, -7))} aria-label="Previous week">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[10rem] px-1 text-center font-mono text-[10px] font-bold uppercase tracking-[0.12em]">
            {label}
          </div>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setAnchor(shiftDays(anchor, 7))} aria-label="Next week">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="ml-1" onClick={() => setAnchor(sastNow().slice(0, 10))}>
            This week
          </Button>
        </div>
        <div className="ml-auto hidden items-center gap-3.5 font-mono text-[9px] font-bold tracking-[0.12em] text-[color:var(--text-muted)] md:flex">
          <span className="flex items-center gap-[5px]">
            <span className="h-[11px] w-[11px] border-[1.5px] border-ink bg-yellow" />
            CURATED BAND
          </span>
          <span className="flex items-center gap-[5px]">
            <span className="h-[11px] w-[11px] border border-rule bg-bone-2" />
            BOOKED SET
          </span>
          <span className="flex items-center gap-[5px]">
            <Squares stations={[true, false]} size={11} />
            PRACTICE
          </span>
          {opens && (
            <span className="border border-ink px-3 py-[9px] text-[9.5px] text-ink">
              {week && week.now < week.opensAt ? "THIS WEEK OPENS" : "NEXT WEEK OPENS"} {shortDayLabel(opens)}
            </span>
          )}
        </div>
      </div>

      <div className="px-5 py-6 md:px-8 md:py-7">
        {!week ? (
          <p className="mono-label py-20 text-center">Loading practice…</p>
        ) : (
          <>
            <div className="hidden md:block">
              <AfternoonWall week={week} sets={sets} bands={bands} userId={userId} onOpen={setTarget} />
            </div>
            <div className="md:hidden">
              <PhonePractice week={week} userId={userId} onOpen={setTarget} />
            </div>
            {!week.me.canBook && (
              <p className="mt-4 font-mono text-[9.5px] uppercase tracking-[0.08em] text-[color:var(--text-tertiary)]">
                Anyone in the prayer room can book practice. Join the room to get a station.
              </p>
            )}
          </>
        )}
      </div>

      <PracticeDrawers week={week} target={target} setTarget={setTarget} userId={userId} onChanged={reload} />
    </div>
  );
}
