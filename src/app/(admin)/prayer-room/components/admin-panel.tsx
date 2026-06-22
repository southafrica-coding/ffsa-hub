"use client";

import { useEffect, useState, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  fullName,
  formatTimeRange,
  formatDateLabel,
  APPLICATION_STATUS_LABELS,
  MEMBER_STATUS_LABELS,
  type Person,
} from "./helpers";

export default function AdminPanel() {
  return (
    <Tabs defaultValue="applications">
      <TabsList>
        <TabsTrigger value="applications">Applications</TabsTrigger>
        <TabsTrigger value="blockout">Block-out</TabsTrigger>
        <TabsTrigger value="members">Members</TabsTrigger>
      </TabsList>
      <TabsContent value="applications" className="mt-4">
        <ApplicationsManager />
      </TabsContent>
      <TabsContent value="blockout" className="mt-4">
        <BlockoutManager />
      </TabsContent>
      <TabsContent value="members" className="mt-4">
        <MembersManager />
      </TabsContent>
    </Tabs>
  );
}

// ── Applications: assign evaluators ─────────────────────────
interface Application {
  id: string;
  status: string;
  applicant: Person;
  evaluator: Person;
  skills: { label: { id: string; name: string } | null }[];
}
interface Evaluator {
  user_id: string;
  user: Person;
}

function ApplicationsManager() {
  const [apps, setApps] = useState<Application[]>([]);
  const [evaluators, setEvaluators] = useState<Evaluator[]>([]);
  const [loading, setLoading] = useState(true);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, e] = await Promise.all([
        fetch("/api/prayer-room/applications?scope=all").then((r) => (r.ok ? r.json() : [])),
        fetch("/api/prayer-room/members?evaluators=true").then((r) => (r.ok ? r.json() : [])),
      ]);
      setApps(a);
      setEvaluators(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function assign(id: string) {
    const evaluatorId = pick[id];
    if (!evaluatorId) return toast.error("Choose an evaluator");
    setBusy(id);
    try {
      const res = await fetch(`/api/prayer-room/applications/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign", evaluator_id: evaluatorId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      toast.success("Evaluator assigned");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  // Manager can decide directly — with or without an evaluator assigned.
  async function decide(id: string, approve: boolean) {
    setBusy(id);
    try {
      const res = await fetch(`/api/prayer-room/applications/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decide", approve, decision_note: note[id] || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      toast.success(approve ? "Approved — welcome them in!" : "Marked not approved");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="py-12 text-center text-muted-foreground">Loading…</p>;

  const pending = apps.filter((a) => a.status === "applied");
  const inProgress = apps.filter((a) => a.status === "assigned" || a.status === "evaluated");
  const decided = apps.filter((a) => a.status === "approved" || a.status === "denied" || a.status === "withdrawn");

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Needs an evaluator {pending.length > 0 && <span className="text-primary">({pending.length})</span>}
        </h3>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing waiting to be assigned.</p>
        ) : (
          <div className="space-y-2">
            {pending.map((a) => (
              <div key={a.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium">{fullName(a.applicant)}</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {a.skills.map((s, i) => s.label && <Badge key={i} variant="secondary" className="text-[10px]">{s.label.name}</Badge>)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select value={pick[a.id] ?? ""} onValueChange={(v) => setPick((p) => ({ ...p, [a.id]: v }))}>
                      <SelectTrigger className="h-8 w-44">
                        <SelectValue placeholder="Choose evaluator" />
                      </SelectTrigger>
                      <SelectContent>
                        {evaluators.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No evaluators yet — grant the “Evaluate Prayer Room Applicants” permission to someone.</div>}
                        {evaluators.map((ev) => (
                          <SelectItem key={ev.user_id} value={ev.user_id}>
                            {fullName(ev.user)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" disabled={busy === a.id} onClick={() => assign(a.id)}>
                      Assign
                    </Button>
                  </div>
                </div>
                <DecideControls
                  id={a.id}
                  note={note}
                  setNote={setNote}
                  busy={busy === a.id}
                  onDecide={decide}
                  hint="Or decide now — no evaluator needed."
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {inProgress.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">With evaluators</h3>
          <div className="space-y-2">
            {inProgress.map((a) => (
              <div key={a.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{fullName(a.applicant)}</span>
                  <span className="text-xs text-muted-foreground">
                    {APPLICATION_STATUS_LABELS[a.status]} · {fullName(a.evaluator)}
                  </span>
                </div>
                <DecideControls id={a.id} note={note} setNote={setNote} busy={busy === a.id} onDecide={decide} />
              </div>
            ))}
          </div>
        </section>
      )}

      {decided.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Decided</h3>
          <div className="space-y-1.5">
            {decided.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm">
                <span>{fullName(a.applicant)}</span>
                <Badge variant={a.status === "approved" ? "default" : "secondary"}>{APPLICATION_STATUS_LABELS[a.status]}</Badge>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// Shared approve/deny control for the manager — usable on any open application.
function DecideControls({
  id,
  note,
  setNote,
  busy,
  onDecide,
  hint,
}: {
  id: string;
  note: Record<string, string>;
  setNote: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  busy: boolean;
  onDecide: (id: string, approve: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <Label className="text-xs">Decision note (optional, shared with applicant)</Label>
      <Textarea
        value={note[id] ?? ""}
        onChange={(e) => setNote((n) => ({ ...n, [id]: e.target.value }))}
        rows={2}
      />
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => onDecide(id, true)}>
          Approve
        </Button>
        <Button size="sm" variant="outline" className="text-destructive" disabled={busy} onClick={() => onDecide(id, false)}>
          Deny
        </Button>
      </div>
    </div>
  );
}

// ── Block-out dates ─────────────────────────────────────────
interface Blockout {
  id: string;
  block_date: string;
  start_time: string;
  end_time: string;
  reason: string | null;
  relocation_note: string | null;
}

function BlockoutManager() {
  const [blockouts, setBlockouts] = useState<Blockout[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/prayer-room/blockouts");
      setBlockouts(res.ok ? await res.json() : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function addBlockout(form: FormData) {
    const start_time = String(form.get("start_time") || "");
    const end_time = String(form.get("end_time") || "");
    if (end_time <= start_time) {
      toast.error("End time must be after start time");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/prayer-room/blockouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          block_date: form.get("block_date"),
          start_time,
          end_time,
          reason: form.get("reason") || null,
          relocation_note: form.get("relocation_note") || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      const moved =
        data.affected > 0
          ? `Blocked out — ${data.affected} set${data.affected === 1 ? "" : "s"} relocated`
          : "Blocked out — no sets in that window";
      const slack = data.slack as { ok?: boolean; skipped?: string; error?: string } | undefined;
      if (slack?.ok) {
        toast.success(`${moved}. Team notified on Slack.`);
      } else if (slack?.skipped) {
        toast.warning(`${moved}. Slack not posted — SLACK_PRAYER_ROOM_CHANNEL_ID isn't set on this deployment yet.`);
      } else if (slack?.error === "not_in_channel") {
        toast.warning(`${moved}. Slack post failed — invite the bot to the channel (type /invite @FFSA Hub Activity there).`);
      } else if (slack?.error) {
        toast.warning(`${moved}. Slack post failed: ${slack.error}.`);
      } else {
        toast.success(moved);
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeBlockout(id: string) {
    const res = await fetch(`/api/prayer-room/blockouts?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Block-out removed");
      load();
    } else {
      toast.error("Failed to remove");
    }
  }

  if (loading) return <p className="py-12 text-center text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Block out a time</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          When the prayer room is needed for another event, block the window here. Any devo sets in it are tagged as
          relocated and the worship team is notified on Slack.
        </p>
        <form action={addBlockout} className="space-y-3 rounded-lg border border-dashed border-border p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Date</Label>
              <Input type="date" name="block_date" required className="w-44" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input type="time" name="start_time" defaultValue="06:00" required className="w-28" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input type="time" name="end_time" defaultValue="08:00" required className="w-28" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Reason (optional)</Label>
              <Input name="reason" placeholder="e.g. Youth conference setup" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Devo sets move to</Label>
              <Input name="relocation_note" placeholder="e.g. The chapel" />
            </div>
          </div>
          <Button type="submit" size="sm" className="gap-1" disabled={busy}>
            <Plus className="h-4 w-4" /> Block out &amp; notify
          </Button>
        </form>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Upcoming block-outs</h3>
        {blockouts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No block-outs scheduled.</p>
        ) : (
          <div className="space-y-2">
            {blockouts.map((b) => (
              <div key={b.id} className="flex items-start justify-between rounded-lg border border-border bg-card px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {formatDateLabel(b.block_date)} · {formatTimeRange(b.start_time, b.end_time)}
                  </div>
                  {b.reason && <div className="text-xs text-muted-foreground">{b.reason}</div>}
                  {b.relocation_note && <div className="text-xs text-amber-400">Moved to: {b.relocation_note}</div>}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-muted-foreground"
                  onClick={() => removeBlockout(b.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Members admin ───────────────────────────────────────────
interface Member {
  user_id: string;
  status: string;
  is_coordinator: boolean;
  user: Person;
}

function MembersManager() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/prayer-room/members");
      setMembers(res.ok ? await res.json() : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function update(userId: string, action: string, value: unknown) {
    setBusy(userId + action);
    try {
      const res = await fetch("/api/prayer-room/members", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, action, value }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="py-12 text-center text-muted-foreground">Loading…</p>;
  if (members.length === 0) return <p className="py-12 text-center text-muted-foreground">No approved members yet.</p>;

  return (
    <div className="space-y-2">
      {members.map((m) => (
        <div key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
          <span className="font-medium">{fullName(m.user)}</span>
          <div className="flex flex-wrap items-center gap-2">
            <ToggleChip label="Coordinator" on={m.is_coordinator} busy={busy === m.user_id + "coordinator"} onClick={() => update(m.user_id, "coordinator", !m.is_coordinator)} />
            <Select value={m.status} onValueChange={(v) => update(m.user_id, "status", v)}>
              <SelectTrigger className="h-8 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(MEMBER_STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ))}
    </div>
  );
}

function ToggleChip({ label, on, busy, onClick }: { label: string; on: boolean; busy: boolean; onClick: () => void }) {
  return (
    <Badge
      variant={on ? "default" : "outline"}
      className={`cursor-pointer select-none ${busy ? "opacity-50" : ""}`}
      onClick={busy ? undefined : onClick}
    >
      {label}
    </Badge>
  );
}
