"use client";

/**
 * Practice drawers — design frames 36b, 36c and 36d.
 *
 *   36b  StationDrawer  tap a row, pick a station (your instrument pre-picked),
 *                       30 or 60 minutes, vocals solo or a group of up to 4.
 *   36c  BandDrawer     the whole room: a name, empty rows only, who's on what.
 *   36d  MoveDrawer     admins only: who loses what, a required reason, the
 *                       exact message each person gets.
 *
 * These grey things out and say why, but they decide nothing. Every rule is
 * enforced by migration 224; when the database refuses, its words are shown.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Drawer } from "@/components/ffsa/client";
import { cn } from "@/lib/utils/cn";
import MemberPicker from "./member-picker";
import {
  PLAIN_BUTTON,
  hhmm,
  isClosedDay,
  practiceRows,
  practisingPhrase,
  rowState,
  shortDayLabel,
  toMin,
  type PracticeBooking,
  type PracticeStation,
  type PracticeWeek,
  type RowState,
} from "@/lib/prayer-room/practice";
import { closureCovering } from "@/lib/prayer-room/room-closure";
import { fullName, type Person } from "./helpers";

type Pick = { id: string; name: string };

export type PracticeTarget =
  | { kind: "row"; date: string; start: number; stationId?: string }
  | { kind: "band"; date: string; start: number }
  | { kind: "move"; args: MoveArgs }
  | null;

type MoveArgs = {
  date: string;
  start: string;
  end: string;
  bandName: string;
  lineup: { station_id: string; user_id: string }[];
  /** Kept so LEAVE THEM, PICK ANOTHER ROW returns to 36c as it was. */
  draft: BandDraft;
};

type BandDraft = { name: string; rows: number[]; lineup: Record<string, Pick[]> };

const range = (a: number, b: number) => `${hhmm(a)} – ${hhmm(b)}`;

function isPast(week: PracticeWeek, date: string, end: number) {
  return `${date}T${hhmm(end)}` <= week.now;
}

function isOpenYet(week: PracticeWeek) {
  return week.now >= week.opensAt;
}

/** "Sample Person 202", "Sample Person 59, Sample Person 258". */
function namesOf(b: PracticeBooking) {
  return b.people.map((p) => p.full_name).join(", ") || "Someone";
}

/** 36c's sentence for a row someone already has: "Sample Person 199 is on drums and Sample Person 190 on bass." */
function whoIsOn(row: RowState, stations: PracticeStation[]): string {
  const parts = stations
    .filter((s) => row.byStation.has(s.id))
    .map((s) => {
      const b = row.byStation.get(s.id)!;
      const who = b.people.map((p) => p.first_name).join(" and ") || "Someone";
      return { who, what: s.label.toLowerCase(), many: b.people.length > 1 };
    });
  if (parts.length === 0) return "";
  const said = parts.map((p, i) =>
    i === 0 ? `${p.who} ${p.many ? "are" : "is"} on ${p.what}` : `${p.who} on ${p.what}`
  );
  const last = said.pop()!;
  return `${said.length ? `${said.join(", ")} and ${last}` : last}.`;
}

/* ── shared bits ───────────────────────────────────── */

function Head({ time, sub }: { time: string; sub?: string }) {
  return (
    <div className="bg-ink px-[22px] pb-[18px]">
      <div className="font-display text-[36px] font-black leading-none tabular-nums text-white">{time}</div>
      {sub && (
        <div className="mt-1.5 font-mono text-[9px] font-bold tracking-[0.12em] text-[#8E8A7C]">{sub}</div>
      )}
    </div>
  );
}

function Label({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between">
      <span className="font-mono text-[9px] font-bold tracking-[0.16em] text-[color:var(--text-tertiary)]">{children}</span>
      {right && <span className="font-mono text-[9px] font-bold tracking-[0.1em] text-ink">{right}</span>}
    </div>
  );
}

function Toggle<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex">
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          type="button"
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "min-h-[44px] flex-1 border border-ink p-3 text-center font-mono text-[10px] font-bold tracking-[0.1em]",
            i > 0 && "border-l-0",
            value === o.value ? "bg-ink text-white" : "text-[color:var(--text-secondary)]",
            o.disabled && "cursor-not-allowed text-[#B4B0A2]"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Cta({
  children,
  onClick,
  disabled,
  tone = "solid",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "solid" | "outline";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "block w-full p-[15px] text-center font-mono text-[10.5px] font-bold tracking-[0.14em]",
        tone === "solid" ? "bg-ink text-white" : "border border-ink text-ink",
        disabled && "cursor-not-allowed opacity-40"
      )}
    >
      {children}
    </button>
  );
}

function Foot({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-center font-mono text-[8.5px] tracking-[0.08em] text-[color:var(--text-tertiary)]">{children}</span>
  );
}

/** Why the primary button can't be pressed, or null when it can. */
function blockedReason(week: PracticeWeek, date: string, start: number, end: number): string | null {
  const shut = closureCovering(week.closures, date, start, end);
  if (shut) return shut.label.toUpperCase();
  if (!week.me.canBook) return "ONLY PEOPLE IN THE PRAYER ROOM CAN BOOK";
  if (isPast(week, date, end)) return "THIS TIME HAS GONE";
  if (!isOpenYet(week)) return `OPENS ${shortDayLabel(week.opensAt)}`;
  return null;
}

/* ══ 36b · BOOKING A STATION ═════════════════════════ */

function StationDrawer({
  week,
  date,
  start,
  initialStation,
  userId,
  onClose,
  onChanged,
  onBand,
}: {
  week: PracticeWeek;
  date: string;
  start: number;
  /** 36e: tapping a station chip opens the drawer on that station. */
  initialStation?: string;
  userId: string;
  onClose: () => void;
  onChanged: () => void;
  onBand: () => void;
}) {
  const { settings, stations, bookings } = week;
  const slot = settings.slot_minutes;
  const windowEnd = toMin(settings.end_time);
  const row = rowState(bookings, stations, date, start, start + slot);
  const next = start + 2 * slot <= windowEnd ? rowState(bookings, stations, date, start + slot, start + 2 * slot) : null;

  const firstFree = stations.find((s) => !row.byStation.has(s.id))?.id ?? null;
  const free = (id: string | null | undefined) => !!id && !row.byStation.has(id);
  const preferred = free(initialStation)
    ? initialStation!
    : free(week.me.defaultStationId)
      ? week.me.defaultStationId!
      : firstFree;

  const [stationId, setStationId] = useState<string | null>(preferred);
  const [minutes, setMinutes] = useState<number>(slot);
  const [mode, setMode] = useState<"solo" | "group">("solo");
  const [singers, setSingers] = useState<Pick[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const station = stations.find((s) => s.id === stationId) ?? null;
  const isGroupable = (station?.max_people ?? 1) > 1;
  const group = isGroupable && mode === "group";

  // Can this station run on into the next row? (36b: "Keys is free at 17:00 too.")
  const longer = useMemo(() => {
    if (!station) return { ok: false, note: "" };
    if (!next) return { ok: false, note: `Practice ends at ${settings.end_time}.` };
    const nextShut = closureCovering(week.closures, date, start + slot, start + 2 * slot);
    if (nextShut) return { ok: false, note: `${nextShut.label}.` };
    if (next.band) return { ok: false, note: `A band has the room at ${hhmm(start + slot)}.` };
    if (next.byStation.has(station.id)) {
      return { ok: false, note: `${station.label} is taken at ${hhmm(start + slot)}.` };
    }
    return {
      ok: true,
      note: `${station.label} is free at ${hhmm(start + slot)} too. You'll have ${hhmm(start)}–${hhmm(start + 2 * slot)}.`,
    };
  }, [station, next, settings.end_time, start, slot, week.closures, date]);

  useEffect(() => {
    if (!longer.ok && minutes > slot) setMinutes(slot);
  }, [longer.ok, minutes, slot]);

  const end = start + minutes;
  const blocked = blockedReason(week, date, start, end);
  const taken = row.byStation.size;
  const people = group ? singers.length + 1 : 1;

  async function book() {
    if (!station) return;
    setBusy(true);
    try {
      const res = await fetch("/api/prayer-room/practice/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "station",
          date,
          start: hhmm(start),
          end: hhmm(end),
          stationId: station.id,
          singers: group ? singers.map((s) => s.id) : [],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not book that");
        return;
      }
      toast.success(`${station.label} booked · ${hhmm(start)}–${hhmm(end)}`);
      onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function cancel(b: PracticeBooking) {
    const res = await fetch(`/api/prayer-room/practice/bookings/${b.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Could not cancel that");
      return;
    }
    toast.success("Booking cancelled");
    onChanged();
  }

  // Under a band nothing else can be booked (rule 7) — say whose room it is.
  if (row.band) {
    const b = row.band;
    const mine = b.booked_by === userId;
    return (
      <>
        <Head time={range(toMin(b.start_time), toMin(b.end_time))} sub="FULL BAND · THE WHOLE ROOM" />
        <div className="border-b border-bone-3 px-[22px] py-4">
          <Label>WHAT EVERYONE SEES ON THE WALL</Label>
          <div className="border-2 border-ink px-3.5 py-3 font-display text-[22px] font-black uppercase leading-none text-ink">
            {b.band_name}
          </div>
        </div>
        <div className="px-[22px] pb-1.5 pt-3.5">
          <Label>WHO&apos;S ON WHAT</Label>
        </div>
        {stations.map((s) => {
          const on = b.people.filter((p) => p.station_id === s.id);
          return (
            <div key={s.id} className="flex items-center gap-3.5 border-b border-bone-3 px-[22px] py-2.5">
              <span className="w-[84px] shrink-0 font-mono text-[9.5px] font-bold tracking-[0.12em] text-[color:var(--text-muted)]">
                {s.label.toUpperCase()}
              </span>
              <span className={cn("text-[13.5px]", on.length ? "font-bold text-ink" : "text-[color:var(--text-quiet)]")}>
                {on.length ? on.map((p) => p.full_name).join(", ") : "Nobody"}
              </span>
            </div>
          );
        })}
        {(mine || week.me.isStaff) && (
          <div className="mt-auto px-[22px] py-4">
            <Cta tone="outline" onClick={() => cancel(b).then(onClose)}>
              CANCEL THE BAND
            </Cta>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <Head time={range(start, start + slot)} sub={`${taken} OF ${stations.length} STATIONS TAKEN`} />

      <div className="px-[22px] pb-1.5 pt-4 font-mono text-[9px] font-bold tracking-[0.16em] text-[color:var(--text-tertiary)]">
        PICK A STATION
      </div>
      <div className="grid grid-cols-2 gap-1.5 px-[22px] pb-4">
        {stations.map((s) => {
          const b = row.byStation.get(s.id);
          const on = s.id === stationId;
          if (b) {
            const mine = b.booked_by === userId || b.people.some((p) => p.user_id === userId);
            return (
              <div
                key={s.id}
                className={cn(
                  "flex min-h-[50px] flex-col justify-center gap-0.5 bg-bone px-3 py-2",
                  mine ? "border-[1.5px] border-ink" : "border border-bone-3"
                )}
              >
                <span className="font-mono text-[9.5px] font-bold tracking-[0.12em] text-[color:var(--text-quiet)]">
                  {s.label.toUpperCase()}
                </span>
                <span className={cn("truncate text-[12.5px] text-[color:var(--text-muted)]", mine && "font-bold text-ink")}>
                  {mine ? "You" : namesOf(b)}
                  {/* Times are per booking, not per row, so a 60 says so. */}
                  {toMin(b.end_time) - toMin(b.start_time) > slot && (
                    <span className="font-normal text-[color:var(--text-quiet)]"> · until {b.end_time}</span>
                  )}
                </span>
                {(b.booked_by === userId || week.me.isStaff) && (
                  <button
                    type="button"
                    onClick={() => cancel(b)}
                    className="self-start font-mono text-[8.5px] font-bold tracking-[0.1em] text-ink underline"
                  >
                    CANCEL
                  </button>
                )}
              </div>
            );
          }
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setStationId(s.id);
                if (s.max_people <= 1) setMode("solo");
              }}
              className={cn(
                PLAIN_BUTTON,
                "flex min-h-[50px] flex-col justify-center gap-0.5 px-3 py-2 text-left",
                on ? "border-2 border-ink bg-ink" : "border border-ink bg-white"
              )}
            >
              <span
                className={cn(
                  "font-mono text-[9.5px] font-bold tracking-[0.12em]",
                  on ? "text-yellow" : "text-ink"
                )}
              >
                {s.label.toUpperCase()}
              </span>
              <span className={cn("text-[12.5px]", on ? "font-bold text-white" : "text-grass")}>
                {on
                  ? group
                    ? `GROUP OF ${people}`
                    : s.id === week.me.defaultStationId
                      ? "YOUR INSTRUMENT"
                      : "PICKED"
                  : "Open"}
              </span>
            </button>
          );
        })}
      </div>

      {station && isGroupable && (
        <div className="border-t border-bone-3 px-[22px] py-3.5">
          <Toggle
            value={mode}
            onChange={setMode}
            options={[
              { value: "solo", label: "JUST ME" },
              { value: "group", label: "A GROUP" },
            ]}
          />
          {group && (
            <div className="mt-3.5">
              <Label right={`${people} OF ${station.max_people} MICS`}>WHO&apos;S SINGING</Label>
              <div className="flex justify-between border-b border-bone-3 py-[11px] text-[13.5px] text-ink">
                <strong>You</strong>
                <span className="font-mono text-[9px] font-bold text-[color:var(--text-tertiary)]">YOU · BOOKING</span>
              </div>
              {singers.map((p) => (
                <div key={p.id} className="flex justify-between border-b border-bone-3 py-[11px] text-[13.5px] text-ink">
                  {p.name}
                  <button
                    type="button"
                    onClick={() => setSingers((xs) => xs.filter((x) => x.id !== p.id))}
                    className="font-mono text-[9px] font-bold text-[color:var(--text-tertiary)]"
                  >
                    REMOVE
                  </button>
                </div>
              ))}
              {people < station.max_people && (
                <button
                  type="button"
                  onClick={() => setPicking(true)}
                  className="py-[11px] font-mono text-[9.5px] font-bold tracking-[0.1em] text-ink"
                >
                  + ADD A SINGER
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {station && (
        <div className="border-t border-bone-3 px-[22px] py-3.5">
          <Label>HOW LONG</Label>
          <Toggle
            value={minutes}
            onChange={setMinutes}
            options={[
              { value: slot, label: `${slot} MIN` },
              { value: 2 * slot, label: `${2 * slot} MIN`, disabled: !longer.ok || 2 * slot > settings.max_minutes },
            ]}
          />
          {longer.note && (
            <div className={cn("mt-2 text-[12.5px]", longer.ok ? "text-grass" : "text-[color:var(--text-tertiary)]")}>
              {longer.note}
            </div>
          )}
        </div>
      )}

      {/* The full-band option sits under the stations, greyed with the reason
          when anyone is already in the row (rule 8). */}
      <div className="flex items-center justify-between gap-3 border-t border-bone-3 bg-[var(--surface-hover)] px-[22px] py-[13px]">
        <div>
          <div className={cn("text-[13px] font-bold", row.people ? "text-[color:var(--text-quiet)]" : "text-ink")}>
            Book the whole room
          </div>
          <div className="mt-0.5 font-mono text-[8.5px] font-bold tracking-[0.1em] text-[color:var(--text-quiet)]">
            {row.people ? practisingPhrase(row.people).toUpperCase() : "EVERY STATION · UP TO 60 MIN"}
          </div>
        </div>
        <button
          type="button"
          disabled={row.people > 0}
          onClick={onBand}
          className={cn(
            "min-h-[36px] px-2.5 py-[7px] font-mono text-[9px] font-bold tracking-[0.1em]",
            row.people ? "cursor-not-allowed border border-rule text-[#B4B0A2]" : "border border-ink text-ink"
          )}
        >
          FULL BAND
        </button>
      </div>

      <div className="mt-auto flex flex-col gap-2 px-[22px] py-4">
        {station ? (
          <>
            <Cta onClick={book} disabled={busy || !!blocked}>
              {blocked ??
                `BOOK ${station.label.toUpperCase()}${group ? ` FOR ${people}` : ""} · ${range(start, end)}`}
            </Cta>
            <Foot>
              {group
                ? "ONE BOOKING HOLDS ALL THE MICS · SINGERS CAN'T BOOK VOCALS SEPARATELY"
                : `CANCEL ANY TIME · NOBODY ELSE CAN TAKE ${station.label.toUpperCase()} NOW`}
            </Foot>
          </>
        ) : (
          <Foot>EVERY STATION IS TAKEN IN THIS ROW</Foot>
        )}
      </div>

      <MemberPicker
        open={picking}
        onClose={() => setPicking(false)}
        title="Add a singer"
        actionLabel="Add"
        excludeIds={[userId, ...singers.map((s) => s.id)]}
        onPick={(id, m) => {
          setSingers((xs) => [...xs, { id, name: fullName(m.user as Person) }]);
          setPicking(false);
        }}
      />
    </>
  );
}

/* ══ 36c · A FULL BAND ═══════════════════════════════ */

function BandDrawer({
  week,
  date,
  start,
  draft: initial,
  onClose,
  onChanged,
  onMakeRoom,
}: {
  week: PracticeWeek;
  date: string;
  start: number;
  draft?: BandDraft;
  onClose: () => void;
  onChanged: () => void;
  onMakeRoom: (args: MoveArgs) => void;
}) {
  const { settings, stations, bookings } = week;
  const slot = settings.slot_minutes;
  const maxRows = Math.floor(settings.max_minutes / slot);
  const rows = practiceRows(settings).map((r) => rowState(bookings, stations, date, r.start, r.end));

  const startRow = rows.find((r) => r.start === start);
  const [name, setName] = useState(initial?.name ?? "");
  const [picked, setPicked] = useState<number[]>(
    initial?.rows ?? (startRow && startRow.people === 0 && !startRow.band ? [start] : [])
  );
  const [lineup, setLineup] = useState<Record<string, Pick[]>>(initial?.lineup ?? {});
  const [pickFor, setPickFor] = useState<PracticeStation | null>(null);
  const [busy, setBusy] = useState(false);

  const sorted = [...picked].sort((a, b) => a - b);
  const span = sorted.length ? { start: sorted[0], end: sorted[sorted.length - 1] + slot } : null;
  const crowded = rows.filter((r) => picked.includes(r.start) && r.people > 0);
  const everyone = Object.values(lineup).flat();

  /** Rows have to touch and stay within 60 minutes. */
  function toggleRow(r: RowState) {
    setPicked((cur) => {
      if (cur.includes(r.start)) {
        // Only from the ends, so the selection never splits in two.
        const s = [...cur].sort((a, b) => a - b);
        return r.start === s[0] || r.start === s[s.length - 1] ? cur.filter((x) => x !== r.start) : cur;
      }
      if (cur.length === 0) return [r.start];
      const s = [...cur].sort((a, b) => a - b);
      const touches = r.start === s[0] - slot || r.start === s[s.length - 1] + slot;
      if (!touches || cur.length >= maxRows) return [r.start];
      return [...cur, r.start];
    });
  }

  function place(st: PracticeStation, p: Pick) {
    setLineup((cur) => {
      // One place per person: picking someone already elsewhere moves them.
      const next: Record<string, Pick[]> = {};
      for (const [k, v] of Object.entries(cur)) next[k] = v.filter((x) => x.id !== p.id);
      next[st.id] = st.max_people > 1 ? [...(next[st.id] ?? []), p] : [p];
      return next;
    });
  }

  function unplace(st: PracticeStation, id: string) {
    setLineup((cur) => ({ ...cur, [st.id]: (cur[st.id] ?? []).filter((x) => x.id !== id) }));
  }

  const flatLineup = () =>
    Object.entries(lineup).flatMap(([station_id, ps]) => ps.map((p) => ({ station_id, user_id: p.id })));

  const blocked = span ? blockedReason(week, date, span.start, span.end) : null;

  async function book() {
    if (!span) return;
    if (!name.trim()) {
      toast.error("Give the band a name");
      return;
    }
    if (crowded.length) {
      onMakeRoom({
        date,
        start: hhmm(span.start),
        end: hhmm(span.end),
        bandName: name.trim(),
        lineup: flatLineup(),
        draft: { name, rows: picked, lineup },
      });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/prayer-room/practice/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "band",
          date,
          start: hhmm(span.start),
          end: hhmm(span.end),
          bandName: name.trim(),
          lineup: flatLineup(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not book the room");
        return;
      }
      toast.success(`${name.trim()} has the room · ${range(span.start, span.end)}`);
      onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="bg-ink px-[22px] pb-[18px]">
        <div className="font-display text-[32px] font-black uppercase leading-none text-white">Book the whole room</div>
      </div>

      <div className="border-b border-bone-3 px-[22px] py-4">
        <Label>WHAT EVERYONE SEES ON THE WALL</Label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name the band"
          maxLength={60}
          className="w-full border-2 border-ink px-3.5 py-3 font-display text-[22px] font-black uppercase leading-none text-ink placeholder:text-[#C7C3B5] focus:outline-none"
        />
      </div>

      <div className="border-b border-bone-3 px-[22px] py-4">
        <Label>WHEN · UP TO {settings.max_minutes} MIN</Label>
        <div className="flex flex-col gap-[5px]">
          {rows.map((r) => {
            const on = picked.includes(r.start);
            const gone = isPast(week, date, r.end);
            const shut = closureCovering(week.closures, date, r.start, r.end);
            if (r.band) {
              return (
                <div key={r.start} className="flex items-center gap-3 border border-bone-3 bg-[var(--surface-hover)] px-3.5 py-3">
                  <span className="h-[15px] w-[15px] shrink-0 bg-rule-strong" />
                  <span className="font-mono text-[11px] font-bold text-[color:var(--text-quiet)]">{range(r.start, r.end)}</span>
                  <span className="flex-1" />
                  <span className="truncate font-mono text-[9px] font-bold tracking-[0.1em] text-[color:var(--text-quiet)]">
                    {r.band.band_name?.toUpperCase()}
                  </span>
                </div>
              );
            }
            // A row with people in it is greyed for everyone (rule 8). Only an
            // admin can pick it anyway, and that goes through 36d.
            const locked = !!shut || (r.people > 0 && !week.me.isStaff) || gone;
            return (
              <button
                key={r.start}
                type="button"
                disabled={locked}
                onClick={() => toggleRow(r)}
                className={cn(
                  PLAIN_BUTTON,
                  "flex items-start gap-3 px-3.5 py-3 text-left",
                  on ? "border-2 border-ink" : "border border-bone-3",
                  (shut || r.people > 0 || gone) && !on && "bg-bone-3"
                )}
              >
                <span
                  className={cn(
                    "mt-px h-[15px] w-[15px] shrink-0",
                    on ? "bg-ink" : "border border-rule"
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex">
                    <span
                      className={cn(
                        "font-mono text-[11px] font-bold",
                        shut || r.people > 0 || gone ? "text-[color:var(--text-quiet)]" : "text-ink"
                      )}
                    >
                      {range(r.start, r.end)}
                    </span>
                    <span className="flex-1" />
                    <span
                      className={cn(
                        "font-mono text-[9px] font-bold tracking-[0.1em]",
                        shut || gone ? "text-[color:var(--text-quiet)]" : r.people ? "text-amber" : "text-grass"
                      )}
                    >
                      {shut ? shut.label.toUpperCase() : gone ? "GONE" : r.people ? `${r.people} PRACTISING` : "EMPTY"}
                    </span>
                  </div>
                  {r.people > 0 && !gone && (
                    <div className="mt-[5px] text-[12px] leading-normal text-[color:var(--text-muted)]">
                      {whoIsOn(r, stations)}{" "}
                      {week.me.isStaff
                        ? "You're an admin, so you can move them to make room."
                        : "Only an admin can move them."}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex justify-between px-[22px] pb-1.5 pt-3.5">
        <span className="font-mono text-[9px] font-bold tracking-[0.16em] text-[color:var(--text-tertiary)]">WHO&apos;S ON WHAT</span>
        <span className="font-mono text-[9px] font-bold tracking-[0.1em] text-ink">
          {everyone.length} {everyone.length === 1 ? "PERSON" : "PEOPLE"} · EACH GETS TOLD
        </span>
      </div>
      {stations.map((s) => {
        const on = lineup[s.id] ?? [];
        const full = on.length >= s.max_people;
        return (
          <div key={s.id} className="flex min-h-[46px] items-center gap-3.5 border-b border-bone-3 px-[22px] py-2.5">
            <span className="w-[84px] shrink-0 font-mono text-[9.5px] font-bold tracking-[0.12em] text-[color:var(--text-muted)]">
              {s.label.toUpperCase()}
            </span>
            <span className="flex min-w-0 flex-1 flex-wrap gap-x-2 text-[13.5px]">
              {on.length === 0 && <span className="text-[color:var(--text-quiet)]">Nobody — leave it empty</span>}
              {on.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => unplace(s, p.id)}
                  title="Remove"
                  className={cn(PLAIN_BUTTON, "!font-bold text-ink hover:line-through")}
                >
                  {p.name}
                </button>
              ))}
            </span>
            {!(full && s.max_people > 1) && (
              <button
                type="button"
                onClick={() => setPickFor(s)}
                className="font-mono text-[9px] font-bold tracking-[0.1em] text-[color:var(--text-tertiary)]"
              >
                {on.length && s.max_people <= 1 ? "CHANGE" : "+ ADD"}
              </button>
            )}
          </div>
        );
      })}

      <div className="mt-auto flex flex-col gap-2 px-[22px] py-4">
        <Cta onClick={book} disabled={busy || !span || !!blocked}>
          {!span
            ? "PICK A ROW"
            : (blocked ??
              (crowded.length
                ? `MAKE ROOM · ${range(span.start, span.end)}`
                : `BOOK THE ROOM · ${range(span.start, span.end)}`))}
        </Cta>
        {crowded.length > 0 && <Foot>NEXT YOU&apos;LL SEE WHO LOSES WHAT, AND GIVE A REASON</Foot>}
      </div>

      <MemberPicker
        open={!!pickFor}
        onClose={() => setPickFor(null)}
        title={pickFor ? `Who's on ${pickFor.label.toLowerCase()}?` : ""}
        actionLabel="Add"
        excludeIds={pickFor ? (lineup[pickFor.id] ?? []).map((p) => p.id) : []}
        onPick={(id, m) => {
          if (pickFor) place(pickFor, { id, name: fullName(m.user as Person) });
          setPickFor(null);
        }}
      />
    </>
  );
}

/* ══ 36d · AN ADMIN MAKES ROOM ═══════════════════════ */

type PlanRow = {
  booking_id: string;
  user_id: string;
  person_name: string;
  station: string;
  booked_start: string;
  booked_end: string;
  lost_start: string;
  lost_end: string;
  kept: string | null;
  message: string;
};

function MoveDrawer({
  args,
  onBack,
  onClose,
  onChanged,
}: {
  args: MoveArgs;
  onBack: () => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [reason, setReason] = useState("");
  const [plan, setPlan] = useState<PlanRow[] | null>(null);
  const [previewFor, setPreviewFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (why: string) => {
    const q = new URLSearchParams({ date: args.date, start: args.start, end: args.end, reason: why });
    const res = await fetch(`/api/prayer-room/practice/move?${q}`);
    const data = await res.json().catch(() => []);
    if (!res.ok) {
      toast.error((data as { error?: string }).error ?? "Could not work out who moves");
      setPlan([]);
      return;
    }
    setPlan(data as PlanRow[]);
  }, [args.date, args.start, args.end]);

  // The message is written by the database; refetch it as the reason changes
  // so the preview is exactly what will be sent.
  useEffect(() => {
    const t = setTimeout(() => load(reason), plan === null ? 0 : 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reason, load]);

  const rows = plan ?? [];
  const preview = rows.find((r) => r.user_id === previewFor) ?? rows[0] ?? null;
  const firstName = (n: string) => n.split(" ")[0] || n;

  async function move() {
    setBusy(true);
    try {
      const res = await fetch("/api/prayer-room/practice/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: args.date,
          start: args.start,
          end: args.end,
          bandName: args.bandName,
          lineup: args.lineup,
          reason: reason.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not move them");
        return;
      }
      toast.success(
        `${args.bandName} has the room · ${rows.length} ${rows.length === 1 ? "person" : "people"} told`
      );
      onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="bg-ink px-[22px] pb-[18px]">
        <div className="font-display text-[30px] font-black uppercase leading-none text-white">
          Move {rows.length} {rows.length === 1 ? "person" : "people"} for
          <br />
          {args.bandName}
        </div>
      </div>

      <div className="px-[22px] pb-1.5 pt-3.5 font-mono text-[9px] font-bold tracking-[0.16em] text-[color:var(--text-tertiary)]">
        WHO LOSES WHAT
      </div>
      {plan === null && <p className="mono-label px-[22px] py-3">Working it out…</p>}
      {rows.map((r) => {
        const partial = r.kept !== null;
        return (
          <div key={`${r.booking_id}:${r.user_id}`} className="flex justify-between gap-3.5 border-b border-bone-3 px-[22px] py-3">
            <div>
              <div className="text-[14px] font-bold text-ink">{r.person_name}</div>
              <div className="mt-[3px] font-mono text-[9px] tracking-[0.08em] text-[color:var(--text-tertiary)]">
                {r.station.toUpperCase()} · BOOKED {r.booked_start.slice(0, 5)} – {r.booked_end.slice(0, 5)}
              </div>
            </div>
            <div className="text-right text-[12.5px] leading-normal text-[color:var(--text-secondary)]">
              Loses {partial ? r.lost_start.slice(0, 5) : "all of it"}
              <br />
              {partial ? (
                <span className="text-grass">Keeps {r.kept!.slice(0, 5)}</span>
              ) : (
                <span className="text-[color:var(--text-quiet)]">Keeps nothing that day</span>
              )}
            </div>
          </div>
        );
      })}

      <div className="border-b border-bone-3 px-[22px] py-4">
        <Label>WHY · REQUIRED</Label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Last full run before Friday NIGHT"
          maxLength={200}
          className="w-full border border-ink px-3.5 py-3 text-[13.5px] text-ink focus:outline-none"
        />
      </div>

      {preview && (
        <div className="border-b border-bone-3 px-[22px] py-4">
          <Label
            right={
              rows.length > 1 ? (
                <span className="flex gap-2">
                  {rows.map((r) => (
                    <button
                      key={r.user_id}
                      type="button"
                      onClick={() => setPreviewFor(r.user_id)}
                      className={cn(r.user_id === preview.user_id ? "text-ink underline" : "text-[color:var(--text-quiet)]")}
                    >
                      {firstName(r.person_name).toUpperCase()}
                    </button>
                  ))}
                </span>
              ) : undefined
            }
          >
            WHAT {firstName(preview.person_name).toUpperCase()} GETS
          </Label>
          <div className="border-l-[3px] border-yellow py-0.5 pl-3.5 text-[13.5px] leading-relaxed text-[color:var(--text-strong)]">
            {preview.message}
          </div>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2 px-[22px] py-4">
        <Cta onClick={move} disabled={busy || !reason.trim() || plan === null}>
          MOVE THEM AND BOOK THE BAND
        </Cta>
        <Cta tone="outline" onClick={onBack}>
          LEAVE THEM, PICK ANOTHER ROW
        </Cta>
        <span className="mt-1">
          <Foot>RECORDED WITH YOUR NAME AND REASON · ONLY ADMINS SEE THIS</Foot>
        </span>
      </div>
    </>
  );
}

/* ══ controller ══════════════════════════════════════ */

/**
 * One Drawer, three faces. 36b → 36c → 36d is a path through the same panel,
 * and LEAVE THEM, PICK ANOTHER ROW walks it back with the draft intact.
 */
export default function PracticeDrawers({
  week,
  target,
  setTarget,
  userId,
  onChanged,
}: {
  week: PracticeWeek | null;
  target: PracticeTarget;
  setTarget: (t: PracticeTarget) => void;
  userId: string;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState<BandDraft | undefined>(undefined);
  const close = () => {
    setTarget(null);
    setDraft(undefined);
  };

  if (!week || !target) return null;
  if (target.kind !== "move" && isClosedDay(week.settings, target.date)) return null;

  const label =
    target.kind === "row"
      ? `PRACTICE · ${shortDayLabel(target.date)}`
      : target.kind === "band"
        ? `FULL BAND · ${shortDayLabel(target.date)}`
        : `ADMIN · ${shortDayLabel(target.args.date)} · ${target.args.start} – ${target.args.end}`;

  return (
    <Drawer open onClose={close} label={label}>
      {target.kind === "row" && (
        <StationDrawer
          key={`${target.date}:${target.start}:${target.stationId ?? ""}`}
          week={week}
          date={target.date}
          start={target.start}
          initialStation={target.stationId}
          userId={userId}
          onClose={close}
          onChanged={onChanged}
          onBand={() => setTarget({ kind: "band", date: target.date, start: target.start })}
        />
      )}
      {target.kind === "band" && (
        <BandDrawer
          key={`band:${target.date}`}
          week={week}
          date={target.date}
          start={target.start}
          draft={draft}
          onClose={close}
          onChanged={onChanged}
          onMakeRoom={(args) => {
            setDraft(args.draft);
            setTarget({ kind: "move", args });
          }}
        />
      )}
      {target.kind === "move" && (
        <MoveDrawer
          args={target.args}
          onBack={() => setTarget({ kind: "band", date: target.args.date, start: toMin(target.args.start) })}
          onClose={close}
          onChanged={onChanged}
        />
      )}
    </Drawer>
  );
}
