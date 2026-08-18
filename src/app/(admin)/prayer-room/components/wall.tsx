"use client";

/**
 * The prayer room WALL — design frame 8a.
 *
 * Replaces the old week and day calendar views (the month and list views
 * remain). Five weekday columns, one continuous time axis, blocks drawn to
 * their real duration — so a 30-minute set and a 90-minute set need no special
 * row, which is the whole reason the hour-grid views were dropped.
 *
 * The vocabulary, complete:
 *   bone card     — a set is running
 *   yellow block  — a curated band's set (MORNING / NOON / NIGHT)
 *   dashed white  — a set nobody leads yet: it holds its slot, but is not live
 *   plain white   — nothing there. Unbooked time is NOT a card; white is the
 *                   only "nobody has this" signal.
 */

import { useMemo } from "react";
import { cn } from "@/lib/utils/cn";
import { weekDays } from "@/lib/bookings/dates";
import type { CalendarSet } from "./calendar";

/** A seat's identity, enough to know whether it is a lead seat. */
export type SeatType = { id: string; label: string; is_lead: boolean };

/** A curated anchor band. Empty until migration 171 names some blocks. */
export type Band = {
  id: string;
  band_name: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  weekly_focus: string | null;
};

// Omit rather than intersect: intersecting the two `slots` array types leaves
// the element type as the calendar's narrower one, which has no seat.
export type WallSet = Omit<CalendarSet, "slots"> & {
  slots: { status: string; seat_type_id?: string | null; role?: string | null }[];
};

/* ── axis ─────────────────────────────────────────────
   05:00–24:00. Anything outside collapses into an overnight strip rather than
   stretching the axis to cover a 02:00 set nobody usually books. */
const DAY_START = 5 * 60;
const DAY_END = 24 * 60;
const PX_PER_MIN = 0.72; // ~820px tall; the density the card layouts assume

const WEEKDAYS = [1, 2, 3, 4, 5]; // Mon–Fri. Weekends are not part of the wall.
const WEEKDAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI"];

function toMin(t: string | null | undefined): number {
  const m = (t || "").match(/^(\d{1,2}):(\d{2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0;
}

function hhmm(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function durationLabel(mins: number): string {
  if (mins < 60) return `${mins}min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h${m}`;
}

// Dates come from weekDays() in lib/bookings/dates, which anchors everything
// at UTC midnight. Parsing a date-only string as LOCAL midnight and calling
// toISOString() rolls the day backwards anywhere east of Greenwich — in SAST
// (UTC+2) Monday renders as Sunday's date and every set lands a column adrift.

/**
 * A set is LIVE once one of its lead seats is filled. Until then it holds its
 * slot on the wall as a dashed block and its other seats are locked — design
 * rule 1. Falls back to the legacy `role` strings when seat_type_id has not
 * been backfilled yet, so this renders correctly either side of migration 167.
 */
function isLive(set: WallSet, leadSeatIds: Set<string>): boolean {
  return set.slots.some((s) => {
    if (s.status !== "filled") return false;
    const seat = s.seat_type_id ?? s.role ?? "";
    return leadSeatIds.has(seat);
  });
}

export default function Wall({
  anchorISO,
  sets,
  seatTypes,
  bands = [],
  onOpenSet,
  selectedId,
}: {
  anchorISO: string;
  sets: WallSet[];
  seatTypes: SeatType[];
  bands?: Band[];
  onOpenSet?: (id: string) => void;
  /** The block the drawer is open on — 9a keeps it highlighted behind the panel. */
  selectedId?: string | null;
}) {
  const leadSeatIds = useMemo(
    () =>
      new Set(
        seatTypes.length
          ? seatTypes.filter((s) => s.is_lead).map((s) => s.id)
          : // Before the seat vocabulary exists, the two legacy lead roles.
            ["prayer_leader", "worship_leader"]
      ),
    [seatTypes]
  );

  // weekDays() returns Sun→Sat; the wall shows Mon→Fri.
  const days = useMemo(() => {
    const week = weekDays(anchorISO);
    return WEEKDAYS.map((wd) => ({ weekday: wd, iso: week[wd] }));
  }, [anchorISO]);

  const byDay = useMemo(() => {
    const m = new Map<string, WallSet[]>();
    for (const s of sets) {
      if (s.status === "cancelled") continue;
      const list = m.get(s.set_date) ?? [];
      list.push(s);
      m.set(s.set_date, list);
    }
    return m;
  }, [sets]);

  // Which minutes each named band covers, so the tint can run across all five
  // columns behind the cards.
  const bandRows = useMemo(() => {
    const named = bands.filter((b) => b.band_name);
    const grouped = new Map<string, { name: string; start: number; end: number; focus: string | null }>();
    for (const b of named) {
      const key = b.band_name!;
      const start = toMin(b.start_time);
      const end = toMin(b.end_time);
      const prev = grouped.get(key);
      grouped.set(key, {
        name: key,
        start: prev ? Math.min(prev.start, start) : start,
        end: prev ? Math.max(prev.end, end) : end,
        focus: b.weekly_focus ?? prev?.focus ?? null,
      });
    }
    return [...grouped.values()].sort((a, b) => a.start - b.start);
  }, [bands]);

  const bandMinutes = useMemo(() => {
    const ranges = bandRows.map((b) => [b.start, b.end] as const);
    return (start: number, end: number) =>
      ranges.some(([bs, be]) => start < be && end > bs);
  }, [bandRows]);

  const axisHeight = (DAY_END - DAY_START) * PX_PER_MIN;
  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = DAY_START; h <= DAY_END; h += 60) out.push(h);
    return out;
  }, []);

  return (
    <div className="border border-ink bg-white">
      {/* header row: gutter + five days */}
      <div className="flex border-b border-ink bg-ink">
        <div className="w-16 shrink-0 md:w-[92px]" />
        {days.map((d, i) => (
          <div
            key={d.iso}
            className="flex-1 border-l border-[#2A2A28] px-2 py-2 text-center"
          >
            <div className="font-mono text-[9px] font-bold tracking-[0.18em] text-white">
              {WEEKDAY_LABELS[i]}
            </div>
            <div className="font-mono text-[9px] tracking-[0.1em] text-[#C5C2AE]">
              {d.iso.slice(8, 10)}
            </div>
          </div>
        ))}
      </div>

      <div className="relative flex" style={{ height: axisHeight }}>
        {/* hour gutter */}
        <div className="relative w-16 shrink-0 border-r border-rule md:w-[92px]">
          {hours.map((h) => (
            <div
              key={h}
              className="absolute right-1 -translate-y-1/2 font-mono text-[8.5px] tracking-[0.1em] text-[color:var(--text-tertiary)]"
              style={{ top: (h - DAY_START) * PX_PER_MIN }}
            >
              {hhmm(h)}
            </div>
          ))}
          {/* Each band is a solid black block in the gutter, spanning its own
              height — it paints over the hour labels it covers, which is what
              frames 8a and 9a draw. A small black caption is not the same
              thing: the block is how the three anchors read as structure
              rather than as another label on the axis. */}
          {bandRows.map((b) => (
            <div
              key={b.name}
              className="absolute left-0 right-0 flex flex-col overflow-hidden bg-ink px-1.5 pt-2 md:px-2.5"
              style={{
                top: (b.start - DAY_START) * PX_PER_MIN,
                height: (b.end - b.start) * PX_PER_MIN,
              }}
            >
              <span className="font-display text-[13px] font-black uppercase leading-[0.9] tracking-[0.01em] text-white md:text-[21px]">
                {b.name}
              </span>
              <span className="mt-1 font-mono text-[8.5px] font-bold tracking-[0.08em] text-yellow">
                {hhmm(b.start)}–{hhmm(b.end)}
              </span>
            </div>
          ))}
        </div>

        {/* the five columns */}
        {days.map((d) => {
          const daySets = (byDay.get(d.iso) ?? []).slice().sort(
            (a, b) => toMin(a.start_time) - toMin(b.start_time)
          );
          return (
            <div key={d.iso} className="relative flex-1 border-l border-rule">
              {/* hour rules */}
              {hours.map((h) => (
                <div
                  key={h}
                  className="absolute left-0 right-0 border-t border-[color:var(--surface-4)]"
                  style={{ top: (h - DAY_START) * PX_PER_MIN }}
                />
              ))}

              {/* The band's own hours: WHITE between two 2px black rules. A bone
                  tint reads as "something is booked here", which is exactly
                  what a band is not — the rules bracket the time, the blocks
                  inside it say who has it. */}
              {bandRows.map((b) => (
                <div
                  key={b.name}
                  className="absolute left-0 right-0 border-y-2 border-ink bg-white"
                  style={{
                    top: (b.start - DAY_START) * PX_PER_MIN,
                    height: (b.end - b.start) * PX_PER_MIN,
                  }}
                />
              ))}

              {daySets.map((s) => {
                const start = Math.max(toMin(s.start_time), DAY_START);
                const end = Math.min(toMin(s.end_time), DAY_END);
                if (end <= start) return null;

                const mins = end - start;
                const live = isLive(s, leadSeatIds);
                const curated = bandMinutes(toMin(s.start_time), toMin(s.end_time));
                const title = s.title || s.theme || "Devo set";

                // Card density by duration. Column is ~127px wide, so titles
                // wrap easily — every layout constrains them.
                const full = mins >= 135;
                const mid = !full && mins >= 85;

                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={onOpenSet ? () => onOpenSet(s.id) : undefined}
                    title={`${hhmm(start)}–${hhmm(end)} · ${title}`}
                    className={cn(
                      "absolute left-0 right-0 overflow-hidden px-1.5 text-left",
                      // inset so no two blocks ever touch
                      "mx-[1px]",
                      curated
                        ? "border-2 border-ink bg-yellow"
                        : live
                          ? "border border-rule-strong bg-[color:var(--surface-3)]"
                          : "border border-dashed border-ink bg-white",
                      // Outline rather than a border swap, so the block does not
                      // change size when the drawer opens on it.
                      s.id === selectedId && "z-10 [outline:3px_solid_#0A0A0A]"
                    )}
                    style={{
                      top: (start - DAY_START) * PX_PER_MIN + 1.5,
                      height: Math.max(mins * PX_PER_MIN - 3, 14),
                      paddingTop: full ? 4 : 2,
                    }}
                  >
                    <div className="font-mono text-[8px] font-bold tracking-[0.08em] text-ink">
                      {hhmm(start)}
                      {full && <span className="ml-1 font-normal">· {durationLabel(mins)}</span>}
                    </div>

                    {!live ? (
                      <div className="font-mono text-[8px] font-bold uppercase tracking-[0.1em] text-ink">
                        Needs a lead
                      </div>
                    ) : (
                      <div
                        className={cn(
                          "text-[10px] font-semibold leading-tight text-ink",
                          full ? "line-clamp-2" : "truncate"
                        )}
                      >
                        {title}
                      </div>
                    )}

                    {full && live && s.owner && (
                      <div className="truncate font-mono text-[8px] tracking-[0.06em] text-[color:var(--text-secondary)]">
                        {s.owner.preferred_name || s.owner.first_name}
                      </div>
                    )}
                    {mid && !live && null}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* the vocabulary, stated — the wall is unreadable without it */}
      <div className="flex flex-wrap items-center gap-4 border-t border-ink bg-bone px-4 py-2">
        <Key className="border border-rule-strong bg-[color:var(--surface-3)]">Set running</Key>
        <Key className="border-2 border-ink bg-yellow">Curated band</Key>
        <Key className="border border-dashed border-ink bg-white">Needs a lead</Key>
        <Key className="border border-rule bg-white">Nothing booked</Key>
      </div>
    </div>
  );
}

function Key({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("inline-block h-3 w-5", className)} />
      <span className="mono-label">{children}</span>
    </span>
  );
}
