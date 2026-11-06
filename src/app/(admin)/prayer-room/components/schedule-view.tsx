"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, X, UserPlus, CalendarDays, CalendarRange, List as ListIcon } from "lucide-react";
import { toast } from "sonner";
import { MastheadButton, NeedsYou } from "@/components/ffsa";
import { cn } from "@/lib/utils/cn";
import PrayerRoomChrome, { type TabDef, type TabKey } from "./chrome";
import SetDetail from "./set-detail";
import MemberPicker from "./member-picker";
import { ScheduleCalendar, type CalendarSet, type CalendarBlockout } from "./calendar";
import type { SuggestionsPayload } from "./booking-suggestions";
import Wall, { needsALead, type WallSet, type SeatType, type Band } from "./wall";
import { usePracticeWeek } from "./practice-view";
import PracticeDrawers, { type PracticeTarget } from "./practice-drawers";
import { WEEKDAY_OPTIONS, weeklyOccurrenceDates } from "@/lib/bookings/recurrence";
import {
  todayISO,
  shiftDays,
  weekDays,
  monthGridDays,
  monthLabel,
  weekRangeLabel,
  dayHeadingLabel,
  shiftMonth,
  monthParam,
} from "@/lib/bookings/dates";
import { ROLES, roleLabel, fullName, toISODate, addDays, formatDateLabel } from "./helpers";

type ViewKind = "wall" | "month" | "day" | "list";

// The wall (frame 8a) replaces the old week and day grids: one continuous
// time axis, Mon-Fri, blocks drawn to their real duration. Month and list stay
// — they answer questions the wall deliberately does not. WEEK and DAY are
// module tabs now (10a/12a draw them beside PEOPLE), so only the two
// alternates to the wall are offered here.
const WEEK_VIEWS: { key: Exclude<ViewKind, "day">; label: string; icon: typeof CalendarDays }[] = [
  { key: "wall", label: "Wall", icon: CalendarRange },
  { key: "month", label: "Month", icon: CalendarDays },
  { key: "list", label: "List", icon: ListIcon },
];

interface Props {
  userId: string;
  isStaff: boolean;
  isMember: boolean;
  /** Signed off for at least one seat. Migration 181 gates set creation on it. */
  inCatalogue: boolean;
  /** The module tab strip, rendered as part of this screen (frames 10a/12a). */
  tabs: TabDef[];
  active: TabKey;
  onTabChange: (key: TabKey) => void;
}

function ymOf(iso: string) {
  return { year: parseInt(iso.slice(0, 4), 10), month: parseInt(iso.slice(5, 7), 10) };
}

/** Date range to fetch for the current view + anchor. */
function rangeFor(view: ViewKind, anchor: string): { from: string; to: string } {
  if (view === "day") return { from: anchor, to: anchor };
  if (view === "wall") {
    const d = weekDays(anchor);
    return { from: d[0], to: d[6] };
  }
  const { year, month } = ymOf(anchor);
  const days = monthGridDays(year, month);
  return { from: days[0], to: days[days.length - 1] };
}

export default function ScheduleView({ userId, isStaff, isMember, inCatalogue, tabs, active, onTabChange }: Props) {
  const [weekView, setWeekView] = useState<Exclude<ViewKind, "day">>("wall");
  const view: ViewKind = active === "day" ? "day" : weekView;
  const [anchor, setAnchor] = useState<string>(() => todayISO());
  const [sets, setSets] = useState<CalendarSet[]>([]);
  const [blockouts, setBlockouts] = useState<CalendarBlockout[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Seat vocabulary + curated bands. Loaded once — they change rarely, and the
  // wall renders fine with empty arrays if the migrations aren't applied yet.
  const [seatTypes, setSeatTypes] = useState<SeatType[]>([]);
  const [bands, setBands] = useState<Band[]>([]);

  const { from, to } = rangeFor(view, anchor);

  // The wall's PRACTICE lane (36a). Same week as the wall; null until migration
  // 224 is applied, and the wall then draws no lane.
  const practice = usePracticeWeek(anchor);
  const [practiceTarget, setPracticeTarget] = useState<PracticeTarget>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [setsRes, blockoutsRes, sugRes] = await Promise.all([
        fetch(`/api/prayer-room/sets?dateFrom=${from}&dateTo=${to}`),
        fetch(`/api/prayer-room/blockouts?from=${from}&to=${to}`),
        // Staff also see Space Bookings still waiting on a block-out.
        isStaff ? fetch("/api/prayer-room/booking-suggestions") : Promise.resolve(null),
      ]);
      setSets(setsRes.ok ? await setsRes.json() : []);
      const real: CalendarBlockout[] = blockoutsRes.ok ? await blockoutsRes.json() : [];
      const pending: CalendarBlockout[] = [];
      if (sugRes?.ok) {
        const { suggestions } = (await sugRes.json()) as SuggestionsPayload;
        for (const sug of suggestions) {
          for (const o of sug.occurrences) {
            if (o.endDate < from || o.date > to) continue;
            pending.push({
              id: `pending:${o.bookingId}`,
              block_date: o.date,
              end_date: o.endDate,
              start_time: o.startTime,
              end_time: o.endTime,
              reason: sug.title,
              relocation_note: null,
              pending: true,
            });
          }
        }
      }
      setBlockouts([...real, ...pending]);
    } finally {
      setLoading(false);
    }
  }, [from, to, isStaff]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/prayer-room/wall-meta")
      .then((r) => (r.ok ? r.json() : { seatTypes: [], bands: [] }))
      .then((d) => {
        if (cancelled) return;
        setSeatTypes(d.seatTypes ?? []);
        setBands(d.bands ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function step(dir: -1 | 1) {
    if (view === "day") setAnchor(shiftDays(anchor, dir));
    else if (view === "wall") setAnchor(shiftDays(anchor, dir * 7));
    else {
      const { year, month } = ymOf(anchor);
      const m = shiftMonth(year, month, dir);
      setAnchor(`${monthParam(m.year, m.month)}-01`);
    }
  }

  const { year, month } = ymOf(anchor);
  const headerLabel =
    view === "wall" ? weekRangeLabel(anchor) : view === "day" ? dayHeadingLabel(anchor) : monthLabel(year, month);

  // The masthead's context line: what this week actually looks like, rather
  // than a label that would say the same thing on every week of the year.
  const live = sets.filter((s) => s.status !== "cancelled");
  const seats = live.flatMap((s) => s.slots ?? []);
  const openSeats = seats.filter((sl) => sl.status === "open").length;
  // "Every seat filled" is only true where there were seats to fill. A week with
  // nothing on it, or sets nobody has built a lineup for yet, has none — and
  // saying every seat is filled over an empty wall reads as a broken screen.
  const seatLine =
    openSeats > 0
      ? `${openSeats} ${openSeats === 1 ? "seat" : "seats"} open`
      : seats.length > 0
        ? "every seat filled"
        : "no lineup yet";
  const context = (
    live.length === 0
      ? [headerLabel, "nothing booked"]
      : [headerLabel, `${live.length} ${live.length === 1 ? "set" : "sets"}`, seatLine]
  )
    .join(" · ")
    .toUpperCase();

  // Sets nobody leads yet. The wall marks them with a dashed border and gets
  // on with showing what each set IS; the words belong here, once, in the
  // screen's one yellow band — not repeated on every card.
  const needLead = live.filter((s) => needsALead(s as WallSet, seatTypes));

  // ↑/↓ in the drawer walk the week in the order the wall draws it.
  const ordered = [...live].sort(
    (a, b) => a.set_date.localeCompare(b.set_date) || a.start_time.localeCompare(b.start_time)
  );
  const atIndex = ordered.findIndex((s) => s.id === selectedId);
  const stepSet = (dir: -1 | 1) => {
    if (atIndex < 0) return;
    const next = ordered[atIndex + dir];
    if (next) setSelectedId(next.id);
  };

  // Which curated band, if any, the open set sits inside — 9a's yellow chip.
  const selected = ordered.find((s) => s.id === selectedId) ?? null;
  const bandName =
    selected
      ? bands.find(
          (b) =>
            b.band_name &&
            b.start_time.slice(0, 5) < selected.end_time.slice(0, 5) &&
            b.end_time.slice(0, 5) > selected.start_time.slice(0, 5)
        )?.band_name ?? null
      : null;

  return (
    <div>
      <PrayerRoomChrome
        context={context}
        tabs={tabs}
        active={active}
        onChange={onTabChange}
        actions={
          <>
            {/* The on-ramp, always here and never behind a tab. One label for
                everyone: a member adding a seat is doing the same thing a new
                person is — joining the room for something they are not in it
                for yet. */}
            <MastheadButton tone="outline" onClick={() => onTabChange("join")}>
              + Join the prayer room
            </MastheadButton>
            {/* Creating a set needs a signed-off seat (migration 181). Staff
                always can. Saying why beats a button that fails on click. */}
            {(isStaff || inCatalogue) && (
              <MastheadButton onClick={() => setCreating(true)}>+ New set</MastheadButton>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-rule bg-bone px-5 py-3 md:px-8">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-11 w-11 md:h-8 md:w-8" onClick={() => step(-1)} aria-label="Previous">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[10rem] px-1 text-center font-mono text-[10px] font-bold uppercase tracking-[0.12em]">
            {headerLabel}
          </div>
          <Button variant="outline" size="icon" className="h-11 w-11 md:h-8 md:w-8" onClick={() => step(1)} aria-label="Next">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="ml-1" onClick={() => setAnchor(todayISO())}>
            Today
          </Button>
        </div>

        {isMember && !isStaff && !inCatalogue && (
          <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-[color:var(--text-tertiary)]">
            Signed off for a seat and you can put sets on the wall yourself
          </span>
        )}

        {active === "week" && (
          <div className="ml-auto flex flex-wrap gap-1.5">
            {WEEK_VIEWS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setWeekView(opt.key)}
                className={cn(
                  "px-2.5 py-1.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em]",
                  weekView === opt.key
                    ? "bg-ink text-white"
                    : "border border-rule-strong text-[color:var(--text-secondary)]"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* The screen's ONE yellow band. */}
      {!loading && needLead.length > 0 && (
        <NeedsYou
          action={
            <button
              type="button"
              onClick={() => setSelectedId(needLead[0].id)}
              className="shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink"
            >
              Open the first →
            </button>
          }
        >
          {needLead.length === 1
            ? "1 set here has nobody in a lead seat — it holds its slot, but it is not live."
            : `${needLead.length} sets here have nobody in a lead seat — they hold their slots, but they are not live.`}
        </NeedsYou>
      )}

      <div className="px-5 py-6 md:px-8 md:py-7">
        {loading ? (
          <p className="mono-label py-20 text-center">Loading schedule…</p>
        ) : view === "wall" ? (
          <Wall
            anchorISO={anchor}
            sets={sets as WallSet[]}
            seatTypes={seatTypes}
            bands={bands}
            blockouts={blockouts}
            onOpenSet={setSelectedId}
            selectedId={selectedId}
            practice={
              practice.week
                ? {
                    week: practice.week,
                    userId,
                    onOpen: (date, start) => setPracticeTarget({ kind: "row", date, start }),
                  }
                : null
            }
          />
        ) : (
          <ScheduleCalendar
            view={view}
            anchor={anchor}
            sets={sets}
            blockouts={blockouts}
            onSelect={setSelectedId}
            onPickDay={(iso) => {
              setAnchor(iso);
              onTabChange("day");
            }}
          />
        )}
      </div>

      <SetDetail
        setId={selectedId}
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        userId={userId}
        isStaff={isStaff}
        onChanged={load}
        seatTypes={seatTypes}
        bandName={bandName}
        onPrev={atIndex > 0 ? () => stepSet(-1) : undefined}
        onNext={atIndex >= 0 && atIndex < ordered.length - 1 ? () => stepSet(1) : undefined}
      />

      <PracticeDrawers
        week={practice.week}
        target={practiceTarget}
        setTarget={setPracticeTarget}
        userId={userId}
        onChanged={practice.reload}
      />

      <CreateSetDialog
        open={creating}
        onClose={() => setCreating(false)}
        defaultDate={view === "day" ? anchor : todayISO()}
        onCreated={async (id, firstDate) => {
          setCreating(false);
          // Move to the week the set actually landed in before opening it. A
          // weekly series starting on the first matching weekday on or after
          // "runs from" usually falls in NEXT week, and leaving the wall where
          // it was made a successful create look like nothing had happened.
          if (firstDate) setAnchor(firstDate);
          await load();
          setSelectedId(id); // open the new set so they can build the roster
        }}
      />
    </div>
  );
}

type TeamRow = { user_id: string; name: string; role: string };

function CreateSetDialog({
  open,
  onClose,
  defaultDate,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  defaultDate: string;
  onCreated: (id: string, firstDate: string | null) => void;
}) {
  const [recurrence, setRecurrence] = useState<"none" | "weekly">("none");
  const [setDate, setSetDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState("06:00");
  const [endTime, setEndTime] = useState("08:00");
  const [title, setTitle] = useState("");
  const [theme, setTheme] = useState("");
  const [weekday, setWeekday] = useState(() => new Date(defaultDate + "T00:00:00").getDay());
  const [seriesStart, setSeriesStart] = useState(defaultDate);
  const [seriesEnd, setSeriesEnd] = useState(() => toISODate(addDays(new Date(defaultDate + "T00:00:00"), 77)));
  const [keepTeam, setKeepTeam] = useState(true);
  const [team, setTeam] = useState<TeamRow[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [altVenues, setAltVenues] = useState<{ id: string; name: string }[]>([]);
  const [altVenueId, setAltVenueId] = useState("none");

  // Spaces the set can move to — Music Room comes back first.
  useEffect(() => {
    if (!open || altVenues.length > 0) return;
    fetch("/api/prayer-room/alt-venues")
      .then((r) => (r.ok ? r.json() : []))
      .then((v) => setAltVenues(Array.isArray(v) ? v : []))
      .catch(() => {});
  }, [open, altVenues.length]);

  // Fresh defaults each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setAltVenueId("none");
    const base = new Date(defaultDate + "T00:00:00");
    setRecurrence("none");
    setSetDate(defaultDate);
    setStartTime("06:00");
    setEndTime("08:00");
    setTitle("");
    setTheme("");
    setWeekday(base.getDay());
    setSeriesStart(defaultDate);
    setSeriesEnd(toISODate(addDays(base, 77)));
    setKeepTeam(true);
    setTeam([]);
  }, [open, defaultDate]);

  function addMember(userId: string, name: string) {
    setTeam((prev) =>
      prev.some((t) => t.user_id === userId && t.role === "vocals")
        ? prev
        : [...prev, { user_id: userId, name, role: "vocals" }]
    );
  }

  // What this form will actually create. Both of the surprises live here:
  // a weekly series starts on the first matching weekday ON OR AFTER "runs
  // from", which is usually NEXT week, and the wall only draws Mon-Fri.
  // Neither was visible until after you pressed create.
  const occurrenceDates =
    recurrence === "weekly" ? weeklyOccurrenceDates(seriesStart, seriesEnd, weekday) : [];
  const firstDate = recurrence === "weekly" ? occurrenceDates[0] ?? null : setDate || null;
  const firstIsWeekend = (() => {
    if (!firstDate) return false;
    const d = new Date(`${firstDate}T00:00:00Z`).getUTCDay();
    return d === 0 || d === 6;
  })();

  async function submit() {
    if (endTime <= startTime) {
      toast.error("End time must be after start time");
      return;
    }
    if (recurrence === "weekly" && (!seriesStart || !seriesEnd || seriesEnd < seriesStart)) {
      toast.error("Pick a valid date range for the series");
      return;
    }
    setBusy(true);
    try {
      const teamPayload = team.map((t) => ({ user_id: t.user_id, role: t.role }));
      const alt_venue_id = altVenueId === "none" ? null : altVenueId;
      const body =
        recurrence === "weekly"
          ? {
              recurrence: "weekly",
              start_time: startTime,
              end_time: endTime,
              title: title || null,
              theme: theme || null,
              weekday,
              series_start: seriesStart,
              series_end: seriesEnd,
              keep_team: keepTeam,
              team: teamPayload,
              alt_venue_id,
            }
          : {
              recurrence: "none",
              set_date: setDate,
              start_time: startTime,
              end_time: endTime,
              title: title || null,
              theme: theme || null,
              team: teamPayload,
              alt_venue_id,
            };
      const res = await fetch("/api/prayer-room/sets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create set");
      toast.success(data.count > 1 ? `Created ${data.count} weekly sets` : "Set created — add your roster");
      const alt = data.altBooking as { venue: string; count: number; pending: boolean; error?: string } | null;
      if (alt?.error) {
        toast.error(`The set was created, but ${alt.venue} couldn't be booked: ${alt.error}`);
      } else if (alt) {
        toast.success(
          alt.pending
            ? `${alt.venue} requested in Space Bookings — waiting on approval`
            : `${alt.venue} booked in Space Bookings`
        );
      }
      onCreated(data.id, data.set_date ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create set");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New devo set</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* One-off vs weekly */}
          <div className="flex w-fit items-center border border-rule bg-white p-0.5">
            {(["none", "weekly"] as const).map((r) => (
              <Button
                key={r}
                type="button"
                variant={recurrence === r ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-3"
                onClick={() => setRecurrence(r)}
              >
                {r === "none" ? "One-off" : "Weekly"}
              </Button>
            ))}
          </div>

          {/* When */}
          {recurrence === "none" ? (
            <div className="space-y-1">
              <Label className="text-xs">Date</Label>
              <Input type="date" value={setDate} onChange={(e) => setSetDate(e.target.value)} />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">Day of week</Label>
                <Select value={String(weekday)} onValueChange={(v) => setWeekday(Number(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAY_OPTIONS.map((d) => (
                      <SelectItem key={d.value} value={String(d.value)}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Runs from</Label>
                <Input type="date" value={seriesStart} onChange={(e) => setSeriesStart(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Runs until</Label>
                <Input type="date" value={seriesEnd} onChange={(e) => setSeriesEnd(e.target.value)} />
              </div>
            </div>
          )}

          {/* Times */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Start</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">End</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>

          {/* Before you commit: the date this actually lands on. */}
          {firstDate ? (
            <div className="border border-rule bg-bone px-3 py-2.5">
              <div className="mono-label mb-1">First set</div>
              <div className="text-[13.5px] font-semibold text-ink">
                {formatDateLabel(firstDate)} · {startTime}–{endTime}
                {recurrence === "weekly" &&
                  occurrenceDates.length > 1 &&
                  ` · ${occurrenceDates.length} in the series`}
              </div>
              {firstIsWeekend && (
                <div className="mt-1 text-[12px] text-amber">
                  Weekends are not on the wall — this one shows under Month or List.
                </div>
              )}
            </div>
          ) : (
            <div className="border border-rule bg-bone px-3 py-2.5 text-[13px] text-[color:var(--text-tertiary)]">
              No dates in that range fall on the chosen day.
            </div>
          )}

          {/* Title / theme */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Title (optional)</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Morning devo" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Theme / focus (optional)</Label>
              <Input value={theme} onChange={(e) => setTheme(e.target.value)} />
            </div>
          </div>

          {/* Alternate space — when the prayer room isn't available */}
          <div className="space-y-1">
            <Label className="text-xs">Alternate space (if needed)</Label>
            <Select value={altVenueId} onValueChange={setAltVenueId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None — in the prayer room</SelectItem>
                {altVenues.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {altVenueId !== "none" && (
              <p className="text-[11px] text-muted-foreground">
                {altVenues.find((v) => v.id === altVenueId)?.name ?? "This space"} will be booked in Space Bookings
                as &ldquo;{title.trim() || theme.trim() || "Devo set"}&rdquo;
                {recurrence === "weekly" ? " for every week of the series" : ""}.
              </p>
            )}
          </div>

          {/* Keep-team choice (weekly only) */}
          {recurrence === "weekly" && (
            <div className="space-y-1.5 border border-rule bg-bone p-3">
              <div className="flex w-fit items-center border border-rule bg-white p-0.5">
                {([true, false] as const).map((v) => (
                  <Button
                    key={String(v)}
                    type="button"
                    variant={keepTeam === v ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 px-3"
                    onClick={() => setKeepTeam(v)}
                  >
                    {v ? "Keep same team" : "Open slots each week"}
                  </Button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {keepTeam
                  ? "Each week is created with the team below, invited to accept."
                  : "Each week repeats the same roles as open slots — you'll invite people week by week."}
              </p>
            </div>
          )}

          {/* Team */}
          <div className="space-y-2 border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Team {recurrence === "weekly" && !keepTeam ? "(roles)" : ""}
              </Label>
              <Button type="button" size="sm" variant="outline" className="h-7 gap-1" onClick={() => setPickerOpen(true)}>
                <UserPlus className="h-3.5 w-3.5" /> Add member
              </Button>
            </div>
            {team.length === 0 ? (
              <p className="text-[11px] text-muted-foreground/70">
                No one added yet — you can also build the roster after creating.
              </p>
            ) : (
              <div className="space-y-1.5">
                {team.map((t, i) => (
                  <div key={`${t.user_id}-${i}`} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{t.name}</span>
                    <Select
                      value={t.role}
                      onValueChange={(v) => setTeam((prev) => prev.map((x, j) => (j === i ? { ...x, role: v } : x)))}
                    >
                      <SelectTrigger className="h-8 w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {roleLabel(r)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-muted-foreground"
                      onClick={() => setTeam((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Button type="button" disabled={busy} className="w-full" onClick={submit}>
            {busy ? "Creating…" : recurrence === "weekly" ? "Create weekly series" : "Create set"}
          </Button>
        </div>

        <MemberPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          title="Add a team member"
          onPick={(uid, member) => addMember(uid, fullName(member.user))}
        />
      </DialogContent>
    </Dialog>
  );
}
