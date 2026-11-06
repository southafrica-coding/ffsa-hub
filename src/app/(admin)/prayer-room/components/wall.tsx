"use client";

/**
 * The prayer room WALL — design frame 8a.
 *
 * Replaces the old week and day calendar views (the month and list views
 * remain). Five weekday columns, one continuous time axis, blocks drawn to
 * their real duration — so a 30-minute set and a 90-minute set need no special
 * row, which is the whole reason the hour-grid views were dropped.
 *
 * The vocabulary, complete. FILL says a set exists and whose time it is;
 * BORDER says whether anyone leads it. The two read independently:
 *   bone, solid   — a set is running
 *   bone, dashed  — a set nobody leads yet: it holds its slot, but is not live
 *   yellow        — a curated band's set (MORNING / NOON / NIGHT), solid or
 *                   dashed on the same rule
 *   plain white   — nothing there. White is reserved for unbooked time and
 *                   means nothing else.
 *
 * DEVIATION FROM FRAME 8a, requested 2026-08-18: the frame draws "needs a
 * lead" as dashed WHITE. That made an existing set indistinguishable in fill
 * from empty space, so an unled set read as a hole in the week. Fill now
 * always marks a set.
 */

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { MapPin } from "lucide-react";
import { displayName, offSiteLocation, type Person } from "./helpers";
import { weekDays } from "@/lib/bookings/dates";
import {
  boWin,
  blockoutTip,
  groupBlockoutsByDay,
  isAllDayBlockout,
  type CalendarBlockout,
  type CalendarSet,
} from "./calendar";
import {
  PLAIN_BUTTON,
  bookingNames,
  isClosedDay,
  practiceRows,
  rowState,
  toMin as practiceMin,
  type PracticeWeek,
} from "@/lib/prayer-room/practice";

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
  slots: {
    status: string;
    seat_type_id?: string | null;
    role?: string | null;
    filled?: Person;
  }[];
};

/* ── axis ─────────────────────────────────────────────
   05:00–24:00. Anything outside collapses into an overnight strip rather than
   stretching the axis to cover a 02:00 set nobody usually books. */
const DAY_START = 5 * 60;
const DAY_END = 24 * 60;
const PX_PER_MIN = 0.72; // ~820px tall; the density the card layouts assume

/** Ink hatch at low alpha — "struck out", with whatever is underneath still
 *  legible. Defined once so the legend swatch cannot drift from the wall. */
const BLOCKOUT_HATCH =
  "repeating-linear-gradient(45deg, rgba(10,10,10,0.16) 0 5px, rgba(10,10,10,0.04) 5px 11px)";

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
/**
 * Band names are sized to the gutter, not to a fixed number.
 *
 * The frames draw the name at 21px, but their gutter is nominal: measured in
 * the Hub's own Roboto Condensed Black, caps run ~0.585em per character, so
 * MORNING at 21px is 86px against the gutter's 72px of text space and lost its
 * last letter. Band names are created by staff now — AFTERNOON, WATCH OF THE
 * LORD, anything — so a constant would keep breaking. 21px stays the cap, which
 * is what short names like NOON and NIGHT still get.
 */
const CHAR_EM = 0.585;
function bandNameSize(name: string, space: number, max: number): number {
  return Math.max(9, Math.min(max, Math.floor(space / (Math.max(name.length, 1) * CHAR_EM))));
}

export function isLive(set: WallSet, leadSeatIds: Set<string>): boolean {
  return set.slots.some((s) => {
    if (s.status !== "filled") return false;
    const seat = s.seat_type_id ?? s.role ?? "";
    return leadSeatIds.has(seat);
  });
}

/**
 * Who is leading this set — the person in the first filled lead seat. Shown on
 * the wall card after the title so the week reads without opening anything.
 */
export function leadName(set: WallSet, leadSeatIds: Set<string>): string | null {
  for (const s of set.slots) {
    if (s.status !== "filled" || !s.filled) continue;
    const seat = s.seat_type_id ?? s.role ?? "";
    if (leadSeatIds.has(seat)) return displayName(s.filled);
  }
  return null;
}

/**
 * Does this set still have nobody leading it? The wall says so with a dashed
 * border; the SCREEN says so in words, in one band, away from the cards.
 */
export function needsALead(set: WallSet, seatTypes: SeatType[]): boolean {
  const leads = new Set(
    seatTypes.length
      ? seatTypes.filter((s) => s.is_lead).map((s) => s.id)
      : ["prayer_leader", "worship_leader"]
  );
  return !isLive(set, leads);
}

export default function Wall({
  anchorISO,
  sets,
  seatTypes,
  bands = [],
  blockouts = [],
  onOpenSet,
  selectedId,
  practice,
}: {
  anchorISO: string;
  sets: WallSet[];
  seatTypes: SeatType[];
  bands?: Band[];
  /** Times the room is not available. The wall drew none of these before. */
  blockouts?: CalendarBlockout[];
  onOpenSet?: (id: string) => void;
  /** The block the drawer is open on — 9a keeps it highlighted behind the panel. */
  selectedId?: string | null;
  /**
   * Frame 36a's PRACTICE lane: a bone lane in the gutter between the ordinary
   * sets and NIGHT, a row of station squares per 30 minutes. Omitted when the
   * practice tables aren't there yet. Practice is not a set and is not
   * coverage — it is drawn here and counted nowhere.
   */
  practice?: {
    week: PracticeWeek;
    userId: string;
    /** Optional so the dev-only fixture page (a server component) can draw it. */
    onOpen?: (date: string, start: number) => void;
  } | null;
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

  // Grouped with the calendar's own helper, so the two views cannot disagree
  // about which days a multi-day block-out covers.
  const blockoutsByDay = useMemo(() => groupBlockoutsByDay(blockouts), [blockouts]);

  const axisHeight = (DAY_END - DAY_START) * PX_PER_MIN;
  // Hour LINES run to the end of the axis; hour LABELS stop one short of it.
  // 24:00 is the boundary, not a slot, and labelling it hangs half a label
  // below the grid. Frames 8a/9a label 05:00 through 23:00.
  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = DAY_START; h <= DAY_END; h += 60) out.push(h);
    return out;
  }, []);
  const hourLabels = useMemo(() => hours.filter((h) => h < DAY_END), [hours]);
  // Phone shows one weekday at a time. 0 is Monday.
  const [phoneDay, setPhoneDay] = useState(() => {
    const wd = new Date().getDay();
    return wd >= 1 && wd <= 5 ? wd - 1 : 0;
  });

  return (
    <div className="border border-ink bg-white">
      <div className="grid grid-cols-5 border-b border-ink md:hidden">
        {days.map((d, i) => (
          <button
            key={d.iso}
            type="button"
            onClick={() => setPhoneDay(i)}
            aria-pressed={i === phoneDay}
            className={cn(
              "flex min-h-11 flex-col items-center justify-center",
              i === phoneDay ? "bg-ink text-white" : "bg-bone text-ink"
            )}
          >
            <span className="font-mono text-[9px] font-bold tracking-[0.12em]">{WEEKDAY_LABELS[i]}</span>
            <span className="font-display text-[16px] font-black leading-none">{d.iso.slice(8, 10)}</span>
          </button>
        ))}
      </div>
      {/* header row: gutter + five days */}
      <div className="hidden border-b border-ink bg-ink md:flex">
        <div className="w-16 shrink-0 md:w-[92px]" />
        {days.map((d, i) => (
          <div
            key={d.iso}
            className={cn("flex-1 border-l border-[#2A2A28] px-2 py-2 text-center", i !== phoneDay && "max-md:hidden")}
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
          {/* Sits just under its own hour line rather than centred on it —
              centring clipped 05:00 against the black header and 24:00 against
              the legend. 10px clear of the rule, and the axis grey the frames
              use, which is quieter than the body's tertiary text. */}
          {hourLabels.map((h) => (
            <div
              key={h}
              className="absolute right-2.5 translate-y-px font-mono text-[8.5px] tracking-[0.04em] text-[#B5B1A3] tabular-nums"
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
          {practice && <PracticeGutter week={practice.week} />}
          {bandRows.map((b) => (
            <div
              key={b.name}
              className="absolute left-0 right-0 flex flex-col overflow-hidden whitespace-nowrap bg-ink px-1.5 pt-2 md:px-2.5"
              style={{
                top: (b.start - DAY_START) * PX_PER_MIN,
                height: (b.end - b.start) * PX_PER_MIN,
              }}
            >
              {/* Two spans because the gutter is 64px below md and 92px above,
                  and an inline font-size cannot be responsive. */}
              <span
                className="font-display font-black uppercase leading-[0.9] tracking-[0.01em] text-white md:hidden"
                style={{ fontSize: bandNameSize(b.name, 52, 15) }}
              >
                {b.name}
              </span>
              <span
                className="hidden font-display font-black uppercase leading-[0.9] tracking-[0.01em] text-white md:block"
                style={{ fontSize: bandNameSize(b.name, 72, 21) }}
              >
                {b.name}
              </span>
              <span className="mt-1 font-mono text-[8.5px] font-bold tracking-[0.08em] text-yellow">
                {hhmm(b.start)}–{hhmm(b.end)}
              </span>
            </div>
          ))}
        </div>

        {/* the five columns */}
        {days.map((d, i) => {
          const daySets = (byDay.get(d.iso) ?? []).slice().sort(
            (a, b) => toMin(a.start_time) - toMin(b.start_time)
          );
          return (
            <div key={d.iso} className={cn("relative flex-1 border-l border-rule", i !== phoneDay && "max-md:hidden")}>
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
                const lead = leadName(s, leadSeatIds);
                const location = offSiteLocation(s);

                // Card density by duration. Column is ~127px wide, so titles
                // wrap easily — every layout constrains them.
                const full = mins >= 135;

                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={onOpenSet ? () => onOpenSet(s.id) : undefined}
                    title={`${hhmm(start)}–${hhmm(end)} · ${title}${lead ? ` — ${lead}` : ""}${location ? ` · in ${location}` : ""}${live ? "" : " · needs a lead"}`}
                    className={cn(
                      "absolute left-0 right-0 overflow-hidden px-1.5 text-left",
                      // inset so no two blocks ever touch
                      "mx-[1px]",
                      // Background says a set EXISTS here; border says whether
                      // anyone leads it. White is reserved for time nobody has
                      // booked at all, so an unled set no longer reads as a gap
                      // in the week.
                      curated ? "bg-yellow" : "bg-[color:var(--surface-3)]",
                      live
                        ? curated
                          ? "border-2 border-ink"
                          : "border border-rule-strong"
                        : "border border-dashed border-ink",
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
                    <div className="flex min-w-0 items-center gap-1 font-mono text-[8px] font-bold tracking-[0.08em] text-ink">
                      <span className="shrink-0">
                        {hhmm(start)}
                        {full && <span className="ml-1 font-normal">· {durationLabel(mins)}</span>}
                      </span>
                      {/* Not in the prayer room — said on the card itself, in
                          the time row so even a 30-minute card carries it. */}
                      {location && (
                        <span className="flex min-w-0 items-center gap-0.5 bg-ink px-1 uppercase tracking-[0.06em] text-yellow">
                          <MapPin className="h-2 w-2 shrink-0" aria-hidden />
                          <span className="truncate">{location}</span>
                        </span>
                      )}
                    </div>

                    {/* The title, always. A card that swapped its name for
                        "NEEDS A LEAD" told you what was missing instead of what
                        the set IS — and the dashed border already says the
                        first part. Gaps are reported in the band above the
                        wall and inside the drawer, not on the card. */}
                    <div
                      className={cn(
                        "text-[10px] font-semibold leading-tight text-ink",
                        full ? "line-clamp-2" : "truncate"
                      )}
                    >
                      {title}
                      {/* The lead, inline after a dash — asked for 2026-09-07,
                          so the week says who is leading each set without a
                          click. Same weight as the title but quieter ink, so
                          the set still reads first. */}
                      {lead && (
                        <span className="font-normal text-[color:var(--text-secondary)]">
                          {" — "}
                          {lead}
                        </span>
                      )}
                    </div>

                    {full && s.owner && (
                      <div className="truncate font-mono text-[8px] tracking-[0.06em] text-[color:var(--text-secondary)]">
                        {s.owner.first_name}
                      </div>
                    )}
                  </button>
                );
              })}

              {/* Block-outs sit OVER the sets, struck across them rather than
                  under them. A solid slab hid the very thing you need when a
                  block-out lands on a booked hour: which sets are affected. The
                  hatch is ink at low alpha, so a set underneath still reads —
                  and it never takes a click, so those sets stay openable. */}
              {practice && (
                <PracticeColumn
                  week={practice.week}
                  iso={d.iso}
                  userId={practice.userId}
                  onOpen={practice.onOpen}
                />
              )}

              {(blockoutsByDay.get(d.iso) ?? []).map((b) => {
                const w = isAllDayBlockout(b) ? { start: DAY_START, end: DAY_END } : boWin(b);
                const start = Math.max(w.start, DAY_START);
                const end = Math.min(w.end, DAY_END);
                if (end <= start) return null;
                return (
                  <div
                    key={b.id}
                    title={blockoutTip(b)}
                    className={`pointer-events-none absolute left-0 right-0 z-20 overflow-hidden border-y-2 border-ink${b.pending ? " border-dashed opacity-70" : ""}`}
                    style={{
                      top: (start - DAY_START) * PX_PER_MIN,
                      height: (end - start) * PX_PER_MIN,
                      background: BLOCKOUT_HATCH,
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-1 p-1">
                      <span className="bg-ink px-1 py-0.5 font-mono text-[7.5px] font-bold uppercase tracking-[0.12em] text-yellow">
                        {b.pending ? "Pending block-out" : "Blocked"}
                      </span>
                      {b.reason && (
                        <span className="min-w-0 truncate font-mono text-[8px] font-bold uppercase tracking-[0.06em] text-ink">
                          {b.reason}
                        </span>
                      )}
                    </div>
                    {/* Where the sets went, which is the question a block-out
                        raises the moment it lands on a booked hour. */}
                    {b.relocation_note && (
                      <div className="truncate bg-yellow px-1 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.06em] text-ink">
                        Moved → {b.relocation_note}
                      </div>
                    )}
                  </div>
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
        <Key className="border border-dashed border-ink bg-[color:var(--surface-3)]">Needs a lead</Key>
        <Key className="border border-rule bg-white">Nothing booked</Key>
        {practice && <Key className="border-y border-ink bg-bone">Practice · not a set</Key>}
        <Key className="border-2 border-ink" style={{ background: BLOCKOUT_HATCH }}>
          Blocked out
        </Key>
        <span className="flex items-center gap-1.5">
          <span className="flex h-3 items-center bg-ink px-1 text-yellow">
            <MapPin className="h-2 w-2" aria-hidden />
          </span>
          <span className="mono-label">Not in the prayer room</span>
        </span>
      </div>
    </div>
  );
}

function Key({
  className,
  style,
  children,
}: {
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("inline-block h-3 w-5", className)} style={style} />
      <span className="mono-label">{children}</span>
    </span>
  );
}

/* ── 36a · the practice lane, at the wall's own scale ─────────────
   At 0.72px/min a 30-minute row is ~21px, so the wall carries the squares,
   the open count and the names only as far as they fit; the PRACTICE tab
   draws the same afternoon larger. */

function laneBounds(week: PracticeWeek) {
  return { start: practiceMin(week.settings.start_time), end: practiceMin(week.settings.end_time) };
}

function PracticeGutter({ week }: { week: PracticeWeek }) {
  const lane = laneBounds(week);
  return (
    <div
      className="absolute left-0 right-0 flex flex-col overflow-hidden whitespace-nowrap border-y border-ink bg-bone px-1.5 pt-1.5 md:px-2.5"
      style={{ top: (lane.start - DAY_START) * PX_PER_MIN, height: (lane.end - lane.start) * PX_PER_MIN }}
    >
      <span
        className="font-display font-black uppercase leading-[0.9] text-ink"
        style={{ fontSize: bandNameSize("PRACTICE", 72, 15) }}
      >
        Practice
      </span>
      <span className="mt-0.5 font-mono text-[8px] font-bold tracking-[0.06em] text-[#55524A]">
        {hhmm(lane.start)}–{hhmm(lane.end)}
      </span>
    </div>
  );
}

function PracticeColumn({
  week,
  iso,
  userId,
  onOpen,
}: {
  week: PracticeWeek;
  iso: string;
  userId: string;
  onOpen?: (date: string, start: number) => void;
}) {
  const lane = laneBounds(week);
  const top = (m: number) => (m - DAY_START) * PX_PER_MIN;

  if (isClosedDay(week.settings, iso)) {
    // Empty on the wall means free, so a closed window is never left blank.
    return (
      <div
        className="absolute left-0 right-0 z-10 flex items-center justify-center overflow-hidden border-y border-ink px-1"
        style={{
          top: top(lane.start),
          height: (lane.end - lane.start) * PX_PER_MIN,
          background: "repeating-linear-gradient(45deg,#E7E4D9 0 4px,#F8F7F2 4px 9px)",
        }}
        title={`${week.settings.closed_label} · no practice`}
      >
        <span className="truncate bg-[#F8F7F2] px-1 font-mono text-[7.5px] font-bold uppercase tracking-[0.1em] text-[#45423B]">
          {week.settings.closed_label}, no practice
        </span>
      </div>
    );
  }

  const rows = practiceRows(week.settings).map((r) => rowState(week.bookings, week.stations, iso, r.start, r.end));
  const bands = week.bookings.filter((b) => b.kind === "band" && b.practice_date === iso);

  return (
    <>
      <div
        className="pointer-events-none absolute left-0 right-0 border-y border-ink bg-bone"
        style={{ top: top(lane.start), height: (lane.end - lane.start) * PX_PER_MIN }}
      />
      {rows.map((r) => {
        if (r.band) return null;
        let mine = false;
        const names = week.stations
          .filter((s) => r.byStation.has(s.id))
          .map((s) => {
            const b = r.byStation.get(s.id)!;
            if (b.booked_by === userId || b.people.some((p) => p.user_id === userId)) {
              mine = true;
              return "You";
            }
            return bookingNames(b);
          });
        return (
          <button
            key={r.start}
            type="button"
            onClick={() => onOpen?.(iso, r.start)}
            title={`Practice ${hhmm(r.start)}–${hhmm(r.end)} · ${r.open} of ${week.stations.length} open${names.length ? ` · ${names.join(", ")}` : ""}`}
            className={cn(
              PLAIN_BUTTON,
              "absolute left-0 right-0 z-10 mx-[1px] flex items-center gap-1 overflow-hidden bg-white px-1 text-left hover:border-ink",
              mine ? "border-[1.5px] border-ink" : "border border-rule-strong"
            )}
            style={{ top: top(r.start) + 1.5, height: (r.end - r.start) * PX_PER_MIN - 3 }}
          >
            <span className="hidden font-mono text-[7.5px] font-bold text-ink md:inline">{hhmm(r.start)}</span>
            <span className="flex shrink-0 gap-px">
              {week.stations.map((s) => (
                <span
                  key={s.id}
                  className={cn(
                    "h-[6px] w-[5px] border md:w-[6px]",
                    r.byStation.has(s.id) ? "border-ink bg-ink" : "border-[#B4B0A2] bg-white"
                  )}
                />
              ))}
            </span>
            <span
              className={cn(
                "hidden min-w-0 truncate text-[8px] md:inline",
                mine ? "font-bold text-ink" : "text-[#55524A]"
              )}
            >
              {names.length ? names.join(" · ") : `${r.open} open`}
            </span>
          </button>
        );
      })}
      {bands.map((b) => {
        const a = practiceMin(b.start_time);
        const e = practiceMin(b.end_time);
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onOpen?.(iso, a)}
            title={`Full band · ${b.band_name} · ${hhmm(a)}–${hhmm(e)}`}
            className={cn(
              PLAIN_BUTTON,
              "absolute left-0 right-0 z-10 mx-[1px] flex items-center gap-1 overflow-hidden border-2 border-ink bg-white px-1 text-left"
            )}
            style={{ top: top(a) + 1.5, height: (e - a) * PX_PER_MIN - 3 }}
          >
            <span className="flex shrink-0 gap-px">
              {week.stations.map((s) => (
                <span key={s.id} className="h-[6px] w-[5px] border border-ink bg-ink md:w-[6px]" />
              ))}
            </span>
            <span className="min-w-0 truncate text-[8.5px] font-bold uppercase text-ink">{b.band_name}</span>
          </button>
        );
      })}
    </>
  );
}
