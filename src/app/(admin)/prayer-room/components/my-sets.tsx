"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, ChevronDown, ChevronRight, Repeat } from "lucide-react";
import { toast } from "sonner";
import SetDetail from "./set-detail";
import MySeats from "./my-seats";
import {
  roleLabel,
  fullName,
  formatDateLabel,
  formatTime,
  formatTimeRange,
  toISODate,
  type Person,
} from "./helpers";

interface InviteRow {
  id: string;
  role: string;
  status: string;
  required_label: { id: string; name: string } | null;
  set: {
    id: string;
    set_date: string;
    start_time: string;
    end_time: string;
    title: string | null;
    theme: string | null;
    owner: Person;
  } | null;
}
interface OwnedRow {
  id: string;
  set_date: string;
  start_time: string;
  end_time: string;
  title: string | null;
  theme: string | null;
  status: string;
  series_id: string | null;
}
interface RosterRow {
  id: string;
  role: string;
  status: string;
  set: { id: string; set_date: string; start_time: string; end_time: string; title: string | null; status: string; owner: Person } | null;
}

const SEATS_OPEN_KEY = "ffsa.prayer-room.my-seats-open";

/** A run of sets created together by the weekly bulk-add, kept as one item. */
interface SeriesGroup {
  seriesId: string;
  sets: OwnedRow[];
}

export default function MySets({ userId, isStaff }: { userId: string; isStaff: boolean }) {
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [owned, setOwned] = useState<OwnedRow[]>([]);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPastOwned, setShowPastOwned] = useState(false);
  const [showPastRoster, setShowPastRoster] = useState(false);
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set());
  const [editingSeries, setEditingSeries] = useState<SeriesGroup | null>(null);

  // "Your seats & feedback" is collapsed by default so the roster is the first
  // thing on the page — but it opens itself when something there is actually
  // waiting on the person, so feedback written for them is never hidden behind
  // a click they might never take.
  const [seatsOpen, setSeatsOpen] = useState(false);
  // Once the person has expressed a preference, stop auto-opening over them.
  const seatsTouched = useRef(false);
  const [seatsSummary, setSeatsSummary] = useState<{ visible: boolean; feedback: number; pending: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [i, o, r] = await Promise.all([
        fetch("/api/prayer-room/sets?scope=invites").then((x) => (x.ok ? x.json() : [])),
        fetch("/api/prayer-room/sets?scope=owned").then((x) => (x.ok ? x.json() : [])),
        fetch("/api/prayer-room/sets?scope=roster").then((x) => (x.ok ? x.json() : [])),
      ]);
      setInvites(i);
      setOwned(o);
      setRoster(r);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Remembered per browser; read after mount so the server render stays stable.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(SEATS_OPEN_KEY) === "1") {
        setSeatsOpen(true);
        seatsTouched.current = true;
      }
    } catch {
      /* storage unavailable — fall back to the default */
    }
  }, []);

  const onSeatsSummary = useCallback(
    (s: { visible: boolean; feedback: number; pending: number }) => {
      setSeatsSummary(s);
      if (!seatsTouched.current && (s.feedback > 0 || s.pending > 0)) setSeatsOpen(true);
    },
    []
  );

  function toggleSeats() {
    seatsTouched.current = true;
    setSeatsOpen((open) => {
      const next = !open;
      try {
        window.localStorage.setItem(SEATS_OPEN_KEY, next ? "1" : "0");
      } catch {
        /* nothing to remember it with */
      }
      return next;
    });
  }

  async function respond(slotId: string, action: "accept" | "decline") {
    setBusy(slotId);
    try {
      const res = await fetch(`/api/prayer-room/slots/${slotId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      toast.success(action === "accept" ? "You're in!" : "Declined");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  const today = toISODate(new Date());

  // Upcoming leads, grouped: a weekly series collapses into one row, one-offs
  // stay as themselves. Both lists arrive soonest-first from the server.
  const { upcomingOwned, pastOwned } = useMemo(() => {
    const upcoming: Array<SeriesGroup | OwnedRow> = [];
    const past = owned.filter((s) => s.set_date < today).slice().reverse();
    const groups = new Map<string, SeriesGroup>();
    for (const s of owned) {
      if (s.set_date < today) continue;
      if (!s.series_id) {
        upcoming.push(s);
        continue;
      }
      const existing = groups.get(s.series_id);
      if (existing) {
        existing.sets.push(s);
      } else {
        const group: SeriesGroup = { seriesId: s.series_id, sets: [s] };
        groups.set(s.series_id, group);
        upcoming.push(group);
      }
    }
    return { upcomingOwned: upcoming, pastOwned: past };
  }, [owned, today]);

  const upcomingRoster = roster.filter((r) => r.set && r.set.set_date >= today);
  const pastRoster = roster.filter((r) => r.set && r.set.set_date < today).slice().reverse();

  function toggleSeries(id: string) {
    setExpandedSeries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) return <p className="py-12 text-center text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-8">
      {/* Where you stand per seat, and the feedback written for you. */}
      {seatsSummary?.visible !== false && (
        <section>
          <button
            onClick={toggleSeats}
            className="mb-2 flex w-full items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
          >
            {seatsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Your seats &amp; feedback
            {!seatsOpen && !!seatsSummary?.feedback && (
              <span className="text-primary">({seatsSummary.feedback} new)</span>
            )}
          </button>
          <div className={seatsOpen ? undefined : "hidden"}>
            <MySeats onSummary={onSeatsSummary} />
          </div>
        </section>
      )}

      {/* Invitations */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Invitations {invites.length > 0 && <span className="text-primary">({invites.length})</span>}
        </h2>
        {invites.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending invitations.</p>
        ) : (
          <div className="space-y-2">
            {invites.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {roleLabel(inv.role)}
                    {inv.set && <span className="text-muted-foreground"> · {inv.set.title || "Devo set"}</span>}
                  </div>
                  {inv.set && (
                    <div className="text-xs text-muted-foreground">
                      {formatDateLabel(inv.set.set_date)} · {formatTimeRange(inv.set.start_time, inv.set.end_time)}
                      {inv.set.owner && <> · {fullName(inv.set.owner)}</>}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" className="h-8 gap-1" disabled={busy === inv.id} onClick={() => respond(inv.id, "accept")}>
                    <Check className="h-3.5 w-3.5" /> Accept
                  </Button>
                  <Button size="sm" variant="outline" className="h-8" disabled={busy === inv.id} onClick={() => respond(inv.id, "decline")}>
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Sets I own */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Sets I lead</h2>
        {upcomingOwned.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No upcoming sets you lead. Create one from the Schedule tab.
          </p>
        ) : (
          <div className="space-y-2">
            {upcomingOwned.map((item) =>
              "seriesId" in item ? (
                <SeriesRow
                  key={item.seriesId}
                  group={item}
                  expanded={expandedSeries.has(item.seriesId)}
                  onToggle={() => toggleSeries(item.seriesId)}
                  onManage={() => setEditingSeries(item)}
                  onOpenSet={setSelectedId}
                />
              ) : (
                <SetRowButton
                  key={item.id}
                  title={item.title || item.theme || "Devo set"}
                  when={`${formatDateLabel(item.set_date)} · ${formatTimeRange(item.start_time, item.end_time)}`}
                  status={item.status}
                  onClick={() => setSelectedId(item.id)}
                />
              )
            )}
          </div>
        )}
        <PastToggle
          count={pastOwned.length}
          open={showPastOwned}
          onToggle={() => setShowPastOwned((v) => !v)}
        >
          {pastOwned.map((s) => (
            <SetRowButton
              key={s.id}
              title={s.title || s.theme || "Devo set"}
              when={`${formatDateLabel(s.set_date)} · ${formatTimeRange(s.start_time, s.end_time)}`}
              status={s.status}
              onClick={() => setSelectedId(s.id)}
            />
          ))}
        </PastToggle>
      </section>

      {/* Sets I'm playing in */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Sets I&apos;m serving in</h2>
        {upcomingRoster.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming sets you&apos;re rostered into.</p>
        ) : (
          <div className="space-y-2">
            {upcomingRoster.map((r) => (
              <SetRowButton
                key={r.id}
                title={`${r.set!.title || "Devo set"} — ${roleLabel(r.role)}`}
                when={`${formatDateLabel(r.set!.set_date)} · ${formatTimeRange(r.set!.start_time, r.set!.end_time)}`}
                status={r.set!.status}
                onClick={() => setSelectedId(r.set!.id)}
              />
            ))}
          </div>
        )}
        <PastToggle
          count={pastRoster.length}
          open={showPastRoster}
          onToggle={() => setShowPastRoster((v) => !v)}
        >
          {pastRoster.map((r) => (
            <SetRowButton
              key={r.id}
              title={`${r.set!.title || "Devo set"} — ${roleLabel(r.role)}`}
              when={`${formatDateLabel(r.set!.set_date)} · ${formatTimeRange(r.set!.start_time, r.set!.end_time)}`}
              status={r.set!.status}
              onClick={() => setSelectedId(r.set!.id)}
            />
          ))}
        </PastToggle>
      </section>

      <SeriesDialog
        group={editingSeries}
        onClose={() => setEditingSeries(null)}
        onChanged={async () => {
          setEditingSeries(null);
          await load();
        }}
      />

      <SetDetail
        setId={selectedId}
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        userId={userId}
        isStaff={isStaff}
        onChanged={load}
      />
    </div>
  );
}

/** One weekly series as a single item, with its occurrences tucked underneath. */
function SeriesRow({
  group,
  expanded,
  onToggle,
  onManage,
  onOpenSet,
}: {
  group: SeriesGroup;
  expanded: boolean;
  onToggle: () => void;
  onManage: () => void;
  onOpenSet: (id: string) => void;
}) {
  const first = group.sets[0];
  const last = group.sets[group.sets.length - 1];
  const title = first.title || first.theme || "Devo set";
  const range =
    group.sets.length > 1
      ? `${formatDateLabel(first.set_date)} – ${formatDateLabel(last.set_date)}`
      : formatDateLabel(first.set_date);

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <button onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Repeat className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{title}</span>
              <Badge variant="secondary" className="shrink-0">
                {group.sets.length} weeks
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              {range} · {formatTimeRange(first.start_time, first.end_time)}
            </div>
          </div>
        </button>
        <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={onManage}>
          Manage series
        </Button>
      </div>
      {expanded && (
        <div className="border-t border-border">
          {group.sets.map((s) => (
            <button
              key={s.id}
              onClick={() => onOpenSet(s.id)}
              className="flex w-full items-center justify-between px-3 py-2 pl-9 text-left hover:bg-accent"
            >
              <span className="text-sm">{formatDateLabel(s.set_date)}</span>
              <span className="text-xs text-muted-foreground">
                {formatTimeRange(s.start_time, s.end_time)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Edit or clear a whole series at once — the thing that previously took one
 * trip per week. Both actions default to the remaining occurrences; sets that
 * already ran are left alone unless "all" is chosen explicitly.
 */
function SeriesDialog({
  group,
  onClose,
  onChanged,
}: {
  group: SeriesGroup | null;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!group) return;
    const first = group.sets[0];
    setTitle(first.title ?? "");
    setStartTime(formatTime(first.start_time));
    setEndTime(formatTime(first.end_time));
    setConfirmingDelete(false);
  }, [group]);

  if (!group) return null;
  const count = group.sets.length;

  async function save() {
    if (!group) return;
    if (endTime <= startTime) {
      toast.error("End time must be after the start time");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/prayer-room/sets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          series_id: group.seriesId,
          title: title.trim() || null,
          start_time: startTime,
          end_time: endTime,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not update the series");
      toast.success(`Updated ${d.count ?? count} set${(d.count ?? count) === 1 ? "" : "s"}`);
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(scope: "remaining" | "all") {
    if (!group) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/prayer-room/sets?seriesId=${group.seriesId}&scope=${scope === "all" ? "all" : "remaining"}`,
        { method: "DELETE" }
      );
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not delete the series");
      toast.success(`Deleted ${d.count ?? 0} set${d.count === 1 ? "" : "s"}`);
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title || "Devo set"} — weekly series</DialogTitle>
          <DialogDescription>
            Changes apply to the {count} upcoming set{count === 1 ? "" : "s"} in this series. Sets
            that have already happened are left as they are.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="series-title">Title</Label>
            <Input id="series-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="series-start">Start</Label>
              <Input id="series-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="series-end">End</Label>
              <Input id="series-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          {confirmingDelete ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => remove("remaining")}>
                Delete {count} upcoming
              </Button>
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => remove("all")}>
                Delete entire series
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="outline" disabled={busy} onClick={() => setConfirmingDelete(true)}>
              Delete series…
            </Button>
          )}
          <Button disabled={busy} onClick={save}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Past sets stay out of the way but reachable, newest first. */
function PastToggle({
  count,
  open,
  onToggle,
  children,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="mt-3">
      <button
        onClick={onToggle}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {open ? "Hide" : "Show"} past ({count})
      </button>
      {open && <div className="mt-2 space-y-2">{children}</div>}
    </div>
  );
}

function SetRowButton({ title, when, status, onClick }: { title: string; when: string; status: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5 text-left hover:border-primary/50 hover:bg-accent"
    >
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{when}</div>
      </div>
      {status !== "scheduled" && (
        <Badge variant="secondary" className="capitalize">
          {status}
        </Badge>
      )}
    </button>
  );
}
