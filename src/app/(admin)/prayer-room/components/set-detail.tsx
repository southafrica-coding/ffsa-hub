"use client";

import { useEffect, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X, Check, Repeat } from "lucide-react";
import { toast } from "sonner";
import MemberPicker from "./member-picker";
import {
  ROLES,
  roleLabel,
  fullName,
  displayName,
  formatTime,
  formatDateLabel,
  formatTimeRange,
  type Person,
} from "./helpers";

interface Slot {
  id: string;
  role: string;
  status: "open" | "invited" | "filled" | "declined";
  required_label_id: string | null;
  filled_user_id: string | null;
  invitee_id: string | null;
  filled: Person;
  invitee: Person;
  required_label: { id: string; name: string } | null;
}

interface SetRow {
  id: string;
  set_date: string;
  start_time: string;
  end_time: string;
  title: string | null;
  theme: string | null;
  scripture: string | null;
  prayer_focus: string | null;
  setlist: string | null;
  status: string;
  relocation_note: string | null;
  series_id: string | null;
  owner_id: string | null;
  owner: Person;
  slots: Slot[];
}

interface Props {
  setId: string | null;
  open: boolean;
  onClose: () => void;
  userId: string;
  isStaff: boolean;
  onChanged: () => void;
}

export default function SetDetail({ setId, open, onClose, userId, isStaff, onChanged }: Props) {
  const [set, setSet] = useState<SetRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteSlot, setInviteSlot] = useState<Slot | null>(null);
  const [addRole, setAddRole] = useState<string>("vocals");
  const [repeating, setRepeating] = useState(false);

  const load = useCallback(async () => {
    if (!setId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/prayer-room/sets?id=${setId}`);
      setSet(res.ok ? await res.json() : null);
    } finally {
      setLoading(false);
    }
  }, [setId]);

  useEffect(() => {
    if (open && setId) {
      setEditing(false);
      load();
    }
  }, [open, setId, load]);

  const refresh = async () => {
    await load();
    onChanged();
  };

  const canManage = !!set && (isStaff || set.owner_id === userId);

  async function slotAction(slotId: string, body: Record<string, unknown>) {
    setBusy(slotId);
    try {
      const res = await fetch(`/api/prayer-room/slots/${slotId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Action failed");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  async function invite(userIdToInvite: string) {
    if (!inviteSlot) return;
    setBusy(userIdToInvite);
    try {
      const res = await fetch(`/api/prayer-room/slots/${inviteSlot.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "invite", invitee_id: userIdToInvite }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to invite");
      toast.success("Invitation sent");
      setInviteSlot(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to invite");
    } finally {
      setBusy(null);
    }
  }

  async function addSlot() {
    if (!set) return;
    setBusy("add");
    try {
      const res = await fetch(`/api/prayer-room/sets/${set.id}/slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: addRole }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to add slot");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add slot");
    } finally {
      setBusy(null);
    }
  }

  async function removeSlot(slotId: string) {
    setBusy(slotId);
    try {
      const res = await fetch(`/api/prayer-room/slots/${slotId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to remove slot");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove slot");
    } finally {
      setBusy(null);
    }
  }

  async function saveDetails(form: FormData) {
    if (!set) return;
    const set_date = String(form.get("set_date") || "");
    const start_time = String(form.get("start_time") || "");
    const end_time = String(form.get("end_time") || "");
    if (!set_date || !start_time || !end_time) {
      toast.error("Date, start time and end time are all required");
      return;
    }
    if (end_time <= start_time) {
      toast.error("End time must be after start time");
      return;
    }
    setBusy("save");
    try {
      const res = await fetch("/api/prayer-room/sets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: set.id,
          title: form.get("title"),
          theme: form.get("theme"),
          scripture: form.get("scripture"),
          prayer_focus: form.get("prayer_focus"),
          setlist: form.get("setlist"),
          set_date,
          start_time,
          end_time,
        }),
      });
      if (!res.ok) {
        const msg = (await res.json()).error || "Failed to save";
        // 23P01: the no_double_booking exclusion constraint — surface it in plain English.
        throw new Error(
          /no_double_booking|exclusion/i.test(msg)
            ? "That time clashes with someone already serving in another set. Adjust the time, or remove the clashing person first."
            : msg
        );
      }
      toast.success("Set updated");
      setEditing(false);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(action: "complete" | "cancel") {
    if (!set) return;
    setBusy(action);
    try {
      const res = await fetch("/api/prayer-room/sets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: set.id, action }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      toast.success(action === "complete" ? "Marked complete" : "Set cancelled");
      await refresh();
      if (action === "cancel") onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        {loading || !set ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{set.title || "Devo set"}</DialogTitle>
            </DialogHeader>

            <p className="text-sm text-muted-foreground">
              {formatDateLabel(set.set_date)} · {formatTimeRange(set.start_time, set.end_time)}
              {set.owner && <> · led by {fullName(set.owner)}</>}
              {set.status !== "scheduled" && (
                <Badge variant="secondary" className="ml-2 capitalize">
                  {set.status}
                </Badge>
              )}
              {set.series_id && (
                <Badge variant="outline" className="ml-2 gap-1">
                  <Repeat className="h-3 w-3" /> Weekly
                </Badge>
              )}
            </p>

            {set.relocation_note && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
                <span className="font-medium">Relocated</span> → {set.relocation_note}
              </div>
            )}

            {/* Content */}
            {editing ? (
              <form action={saveDetails} className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Date</Label>
                    <Input type="date" name="set_date" defaultValue={set.set_date} required />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Start</Label>
                    <Input type="time" name="start_time" defaultValue={formatTime(set.start_time)} required />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">End</Label>
                    <Input type="time" name="end_time" defaultValue={formatTime(set.end_time)} required />
                  </div>
                </div>
                <Field name="title" label="Title" defaultValue={set.title} />
                <Field name="theme" label="Theme / focus" defaultValue={set.theme} />
                <Field name="scripture" label="Scripture" defaultValue={set.scripture} />
                <Field name="prayer_focus" label="Prayer focus" defaultValue={set.prayer_focus} />
                <div className="space-y-1">
                  <Label className="text-xs">Setlist / notes &amp; links</Label>
                  <Textarea name="setlist" defaultValue={set.setlist ?? ""} rows={4} />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={busy === "save"}>
                    Save
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div className="space-y-1.5 text-sm">
                <ContentLine label="Theme" value={set.theme} />
                <ContentLine label="Scripture" value={set.scripture} />
                <ContentLine label="Prayer focus" value={set.prayer_focus} />
                {set.setlist && (
                  <div>
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">Setlist</span>
                    <p className="whitespace-pre-wrap">{set.setlist}</p>
                  </div>
                )}
                {!set.theme && !set.scripture && !set.prayer_focus && !set.setlist && (
                  <p className="text-muted-foreground">No content added yet.</p>
                )}
              </div>
            )}

            {/* Roster */}
            <div className="space-y-3 border-t border-border pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Roster</p>
              {set.slots.length === 0 && <p className="text-sm text-muted-foreground">No slots yet.</p>}

              {ROLES.filter((r) => set.slots.some((s) => s.role === r)).map((role) => (
                <div key={role} className="space-y-1">
                  <p className="text-xs font-medium text-foreground/70">{roleLabel(role)}</p>
                  {set.slots
                    .filter((s) => s.role === role)
                    .map((slot) => (
                      <div key={slot.id} className="flex items-center justify-between rounded border border-border px-2.5 py-1.5 text-sm">
                        <SlotLabel slot={slot} />
                        <div className="flex items-center gap-1.5">
                          {/* invitee responds to their own invite */}
                          {slot.status === "invited" && slot.invitee_id === userId && (
                            <>
                              <Button size="sm" className="h-7 gap-1" disabled={busy === slot.id} onClick={() => slotAction(slot.id, { action: "accept" })}>
                                <Check className="h-3.5 w-3.5" /> Accept
                              </Button>
                              <Button size="sm" variant="outline" className="h-7" disabled={busy === slot.id} onClick={() => slotAction(slot.id, { action: "decline" })}>
                                Decline
                              </Button>
                            </>
                          )}
                          {canManage && slot.status === "open" && (
                            <Button size="sm" variant="outline" className="h-7" disabled={busy === slot.id} onClick={() => setInviteSlot(slot)}>
                              Invite
                            </Button>
                          )}
                          {canManage && slot.status === "invited" && slot.invitee_id !== userId && (
                            <Button size="sm" variant="ghost" className="h-7" disabled={busy === slot.id} onClick={() => slotAction(slot.id, { action: "vacate" })}>
                              Cancel
                            </Button>
                          )}
                          {canManage && slot.status === "filled" && (
                            <Button size="sm" variant="ghost" className="h-7" disabled={busy === slot.id} onClick={() => slotAction(slot.id, { action: "vacate" })}>
                              Remove
                            </Button>
                          )}
                          {canManage && (
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground" disabled={busy === slot.id} onClick={() => removeSlot(slot.id)} title="Delete slot">
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              ))}

              {canManage && set.status === "scheduled" && (
                <div className="flex items-center gap-2 pt-1">
                  <Select value={addRole} onValueChange={setAddRole}>
                    <SelectTrigger className="h-8 w-44">
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
                  <Button size="sm" variant="outline" className="h-8 gap-1" disabled={busy === "add"} onClick={addSlot}>
                    <Plus className="h-3.5 w-3.5" /> Add slot
                  </Button>
                </div>
              )}
            </div>

            {/* Owner / staff actions */}
            {canManage && (
              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                {!editing && set.status === "scheduled" && (
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                    Edit details
                  </Button>
                )}
                {!editing && set.status === "scheduled" && !set.series_id && (
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => setRepeating(true)}>
                    <Repeat className="h-3.5 w-3.5" /> Repeat weekly
                  </Button>
                )}
                {set.status === "scheduled" && (
                  <>
                    <Button size="sm" variant="outline" disabled={busy === "complete"} onClick={() => setStatus("complete")}>
                      Mark complete
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" disabled={busy === "cancel"} onClick={() => setStatus("cancel")}>
                      Cancel set
                    </Button>
                  </>
                )}
              </div>
            )}
          </>
        )}

        <MemberPicker
          open={!!inviteSlot}
          onClose={() => setInviteSlot(null)}
          requiredLabelId={inviteSlot?.required_label_id ?? undefined}
          title={inviteSlot ? `Invite a ${roleLabel(inviteSlot.role)}` : undefined}
          busyId={busy}
          onPick={(uid) => invite(uid)}
        />

        {set && (
          <RepeatWeeklyDialog
            open={repeating}
            onClose={() => setRepeating(false)}
            setId={set.id}
            setDate={set.set_date}
            onDone={refresh}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RepeatWeeklyDialog({
  open,
  onClose,
  setId,
  setDate,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  setId: string;
  setDate: string;
  onDone: () => void | Promise<void>;
}) {
  const [seriesEnd, setSeriesEnd] = useState("");
  const [keepTeam, setKeepTeam] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const base = new Date(setDate + "T00:00:00");
    base.setDate(base.getDate() + 77);
    setSeriesEnd(base.toISOString().slice(0, 10));
    setKeepTeam(true);
  }, [open, setDate]);

  async function submit() {
    if (!seriesEnd || seriesEnd < setDate) {
      toast.error("Pick an end date on or after this set's date");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/prayer-room/sets/${setId}/repeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ series_end: seriesEnd, keep_team: keepTeam }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(
        data.created > 0
          ? `Now repeating weekly — ${data.created} more set${data.created === 1 ? "" : "s"} created`
          : "Now repeating weekly"
      );
      await onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Repeat weekly</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This set repeats every week on the same day and time until the date you choose. The set you’re looking at
          stays as the first week.
        </p>
        <div className="space-y-1">
          <Label className="text-xs">Runs until</Label>
          <Input type="date" value={seriesEnd} onChange={(e) => setSeriesEnd(e.target.value)} />
        </div>
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
                {v ? "Keep this team" : "Open slots each week"}
              </Button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {keepTeam
              ? "Each new week invites the same people in the same roles."
              : "Each new week repeats the same roles as open slots."}
          </p>
        </div>
        <Button type="button" disabled={busy} className="w-full" onClick={submit}>
          {busy ? "Creating…" : "Create weekly series"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function SlotLabel({ slot }: { slot: Slot }) {
  if (slot.status === "filled") return <span className="font-medium">{displayName(slot.filled)}</span>;
  if (slot.status === "invited")
    return (
      <span className="text-muted-foreground">
        Invited: <span className="text-foreground">{displayName(slot.invitee)}</span>
      </span>
    );
  return (
    <span className="text-amber-400">
      Open{slot.required_label ? ` · ${slot.required_label.name}` : ""}
    </span>
  );
}

function ContentLine({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}: </span>
      <span>{value}</span>
    </div>
  );
}

function Field({ name, label, defaultValue }: { name: string; label: string; defaultValue: string | null }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input name={name} defaultValue={defaultValue ?? ""} />
    </div>
  );
}
