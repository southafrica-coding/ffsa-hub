"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Plus, CalendarPlus, X, UserPlus } from "lucide-react";
import { toast } from "sonner";
import SetDetail from "./set-detail";
import MemberPicker from "./member-picker";
import { WEEKDAY_OPTIONS } from "@/lib/bookings/recurrence";
import { DAYS_SHORT, ROLES, roleLabel, fullName, formatTimeRange, toISODate, weekStartDate, addDays, type Person } from "./helpers";

interface SetSlot {
  id: string;
  role: string;
  status: string;
}
interface SetRow {
  id: string;
  set_date: string;
  start_time: string;
  end_time: string;
  title: string | null;
  theme: string | null;
  status: string;
  owner: Person;
  slots: SetSlot[];
}

interface Props {
  userId: string;
  isStaff: boolean;
  isMember: boolean;
}

export default function ScheduleView({ userId, isStaff, isMember }: Props) {
  const [weekStart, setWeekStart] = useState(() => weekStartDate(new Date()));
  const [sets, setSets] = useState<SetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const weekEnd = addDays(weekStart, 6);
  const todayStr = toISODate(new Date());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/prayer-room/sets?dateFrom=${toISODate(weekStart)}&dateTo=${toISODate(weekEnd)}`);
      setSets(res.ok ? await res.json() : []);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  useEffect(() => {
    load();
  }, [load]);

  async function generateWeek() {
    setBusy(true);
    try {
      const res = await fetch("/api/prayer-room/week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart: toISODate(weekStart) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(data.created > 0 ? `Created ${data.created} set${data.created === 1 ? "" : "s"}` : "This week is already up to date");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const days = Array.from({ length: 7 }, (_, i) => toISODate(addDays(weekStart, i)));
  const setsByDay: Record<string, SetRow[]> = {};
  days.forEach((d) => (setsByDay[d] = []));
  sets.forEach((s) => setsByDay[s.set_date]?.push(s));

  return (
    <div>
      {/* Week nav + actions */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setWeekStart(addDays(weekStart, -7))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(weekStartDate(new Date()))}>
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(addDays(weekStart, 7))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-1 text-sm font-medium">
            {weekStart.toLocaleDateString("en-ZA", { month: "short", day: "numeric" })} –{" "}
            {weekEnd.toLocaleDateString("en-ZA", { month: "short", day: "numeric" })}
          </span>
        </div>
        <div className="flex gap-2">
          {isStaff && (
            <Button variant="outline" size="sm" className="gap-1" disabled={busy} onClick={generateWeek}>
              <CalendarPlus className="h-4 w-4" /> Generate week
            </Button>
          )}
          {(isMember || isStaff) && (
            <Button size="sm" className="gap-1" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New set
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="py-20 text-center text-muted-foreground">Loading schedule…</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-7 md:gap-2">
          {days.map((d, i) => {
            const isToday = d === todayStr;
            return (
              <div key={d} className="min-w-0">
                <div className={`mb-2 rounded-md px-2 py-1 text-center ${isToday ? "bg-primary/10" : ""}`}>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{DAYS_SHORT[i]}</div>
                  <div className={`text-sm font-semibold ${isToday ? "text-primary" : ""}`}>
                    {new Date(d + "T00:00:00").getDate()}
                  </div>
                </div>
                <div className="space-y-2">
                  {setsByDay[d].length === 0 ? (
                    <p className="px-1 text-center text-[11px] text-muted-foreground/60">—</p>
                  ) : (
                    setsByDay[d].map((s) => <SetCard key={s.id} set={s} onClick={() => setSelectedId(s.id)} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <SetDetail
        setId={selectedId}
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        userId={userId}
        isStaff={isStaff}
        onChanged={load}
      />

      <CreateSetDialog
        open={creating}
        onClose={() => setCreating(false)}
        defaultDate={toISODate(weekStart)}
        onCreated={async (id) => {
          setCreating(false);
          await load();
          setSelectedId(id); // open the new set so they can build the roster
        }}
      />
    </div>
  );
}

function SetCard({ set, onClick }: { set: SetRow; onClick: () => void }) {
  const total = set.slots.length;
  const filled = set.slots.filter((s) => s.status === "filled").length;
  const open = set.slots.filter((s) => s.status === "open").length;
  const cancelled = set.status === "cancelled";

  return (
    <button
      onClick={onClick}
      className={`w-full rounded-md border border-border bg-card px-2.5 py-2 text-left transition-colors hover:border-primary/50 hover:bg-accent ${
        cancelled ? "opacity-50" : ""
      }`}
    >
      <div className="text-xs font-semibold leading-tight">{formatTimeRange(set.start_time, set.end_time)}</div>
      <div className="truncate text-[13px] font-medium leading-tight">{set.title || set.theme || "Devo set"}</div>
      {set.owner && <div className="truncate text-[11px] text-muted-foreground">{fullName(set.owner)}</div>}
      <div className="mt-1 flex items-center gap-1.5">
        {total > 0 ? (
          <>
            <span className="text-[10px] text-muted-foreground">
              {filled}/{total}
            </span>
            {open > 0 && (
              <Badge variant="outline" className="h-4 border-amber-500/40 px-1 text-[9px] text-amber-400">
                {open} open
              </Badge>
            )}
          </>
        ) : (
          <span className="text-[10px] text-muted-foreground/60">no roster</span>
        )}
      </div>
    </button>
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
  onCreated: (id: string) => void;
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

  // Fresh defaults each time the dialog opens.
  useEffect(() => {
    if (!open) return;
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
            }
          : {
              recurrence: "none",
              set_date: setDate,
              start_time: startTime,
              end_time: endTime,
              title: title || null,
              theme: theme || null,
              team: teamPayload,
            };
      const res = await fetch("/api/prayer-room/sets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create set");
      toast.success(data.count > 1 ? `Created ${data.count} weekly sets` : "Set created — add your roster");
      onCreated(data.id);
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
          <div className="flex w-fit items-center rounded-md border bg-card p-0.5">
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
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WEEKDAY_OPTIONS.map((d) => (
                      <SelectItem key={d.value} value={String(d.value)}>{d.label}</SelectItem>
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

          {/* Keep-team choice (weekly only) */}
          {recurrence === "weekly" && (
            <div className="space-y-1.5 rounded-md border bg-muted/20 p-3">
              <div className="flex w-fit items-center rounded-md border bg-card p-0.5">
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
                    <Select value={t.role} onValueChange={(v) => setTeam((prev) => prev.map((x, j) => (j === i ? { ...x, role: v } : x)))}>
                      <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>
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
