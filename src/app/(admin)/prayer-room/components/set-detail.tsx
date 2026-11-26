"use client";

/**
 * The set drawer — design frames 9a and 10b (left panel).
 *
 * 9a is emphatic that this is a PANEL and not a page: the week stays visible
 * behind it, the clicked block stays highlighted, and ↑/↓ move to the next set
 * without closing. That is why this is the ffsa `Drawer` rather than the
 * shadcn Dialog it used to be — a centred modal cannot do any of those things.
 *
 * The roster inside it is 10b's LINEUP, which explicitly replaces 9a's flat
 * "on the watch" list: lead seats first at full size, then the rest, each row
 * either a filled seat or a dashed empty one carrying its own way in.
 *
 * NOT built, because neither has a data layer to sit on:
 *   · "I'm coming" — there is no attendance model, only seats.
 *   · "Hand over" — no endpoint transfers ownership of a set.
 * Both are recorded in docs/redesign/91-build-status-and-gaps.md rather than
 * rendered as buttons that do nothing.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Initials } from "@/components/ffsa";
import { Drawer } from "@/components/ffsa/client";
import { cn } from "@/lib/utils/cn";
import SeatFill from "./seat-picker";
import SeatRequests from "./seat-requests";
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

export type SeatType = { id: string; label: string; is_lead: boolean; category?: string; sort_order?: number };

interface Slot {
  id: string;
  role: string;
  /** Canonical seat since migration 167; `role` is the legacy mirror. */
  seat_type_id?: string | null;
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
  alt_venue_id: string | null;
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
  /** Seat vocabulary, so the lineup can order and name seats. */
  seatTypes?: SeatType[];
  /** ↑/↓ between blocks without leaving the drawer — 9a's PREV / NEXT. */
  onPrev?: () => void;
  onNext?: () => void;
  /** Curated band this set falls inside, if any — the yellow chip in 9a. */
  bandName?: string | null;
}

/** Minutes between two "HH:MM[:SS]" strings, for the duration beside the range. */
function durationLabel(start: string, end: string): string {
  const m = (t: string) => {
    const p = (t || "").match(/^(\d{1,2}):(\d{2})/);
    return p ? parseInt(p[1], 10) * 60 + parseInt(p[2], 10) : 0;
  };
  const mins = Math.max(0, m(end) - m(start));
  const h = Math.floor(mins / 60);
  const r = mins % 60;
  return h === 0 ? `${r}MIN` : r === 0 ? `${h}H` : `${h}H ${r}MIN`;
}

export default function SetDetail({
  setId,
  open,
  onClose,
  userId,
  isStaff,
  onChanged,
  seatTypes = [],
  onPrev,
  onNext,
  bandName,
}: Props) {
  const [set, setSet] = useState<SetRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [fillSlot, setFillSlot] = useState<Slot | null>(null);
  const [addRole, setAddRole] = useState<string>("vocals");
  const [repeating, setRepeating] = useState(false);
  // Edit form's "where": "room" = the prayer room, "blockout" = leave the
  // block-out's move as it is, otherwise an alternate space's id.
  const [altVenues, setAltVenues] = useState<{ id: string; name: string }[]>([]);
  const [where, setWhere] = useState("room");

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

  const seatMeta = useMemo(() => new Map(seatTypes.map((s) => [s.id, s])), [seatTypes]);

  /**
   * Owning a set and holding a lead seat are DIFFERENT things, and calling both
   * "lead" is what made the wall and this drawer contradict each other: the
   * wall marks a set as needing a lead when no PRAYER LEAD / WORSHIP LEAD seat
   * is filled, while the drawer was printing the owner as "LED BY". A set can
   * be set up by one person and led by another, or by nobody yet.
   */
  const leadHolders = useMemo(
    () =>
      (set?.slots ?? []).filter(
        (sl) => sl.status === "filled" && isLeadSeat(sl)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [set?.slots, seatMeta]
  );

  function seatLabelOf(slot: Slot): string {
    const id = slot.seat_type_id ?? slot.role;
    return seatMeta.get(id)?.label ?? roleLabel(slot.role);
  }

  function isLeadSeat(slot: Slot): boolean {
    const id = slot.seat_type_id ?? slot.role;
    const meta = seatMeta.get(id);
    if (meta) return meta.is_lead;
    return id === "prayer_leader" || id === "worship_leader";
  }

  /** Lead seats first, then the seat vocabulary's own order — 10b's two blocks. */
  const { leadSlots, otherSlots, openCount } = useMemo(() => {
    const rows = set?.slots ?? [];
    const order = (s: Slot) => seatMeta.get(s.seat_type_id ?? s.role)?.sort_order ?? 99;
    const sorted = [...rows].sort((a, b) => order(a) - order(b));
    return {
      leadSlots: sorted.filter(isLeadSeat),
      otherSlots: sorted.filter((s) => !isLeadSeat(s)),
      openCount: rows.filter((s) => s.status === "open" || s.status === "declined").length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set?.slots, seatMeta]);

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

  /** Ask the lead for an open seat (migration 170). Does not fill anything. */
  async function askForSeat(slot: Slot) {
    if (!set) return;
    setBusy(slot.id);
    try {
      const res = await fetch("/api/prayer-room/requests?kind=seat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ set_id: set.id, seat_type_id: slot.seat_type_id ?? slot.role }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error || "Could not send the request");
        return;
      }
      toast.success("Asked — the set's lead will see it");
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function invite(userIdToInvite: string) {
    if (!fillSlot) return;
    setBusy(userIdToInvite);
    try {
      const res = await fetch(`/api/prayer-room/slots/${fillSlot.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "invite", invitee_id: userIdToInvite }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to invite");
      toast.success("Invitation sent");
      setFillSlot(null);
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

  useEffect(() => {
    if (!editing || !set) return;
    setWhere(set.alt_venue_id ?? (set.relocation_note ? "blockout" : "room"));
    if (altVenues.length > 0) return;
    fetch("/api/prayer-room/alt-venues")
      .then((r) => (r.ok ? r.json() : []))
      .then((v) => setAltVenues(Array.isArray(v) ? v : []))
      .catch(() => {});
  }, [editing, set, altVenues.length]);

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
          ...(where === "blockout" ? {} : { alt_venue_id: where === "room" ? null : where }),
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
      const saved = (await res.json().catch(() => ({}))) as { altBookingNotice?: string };
      if (saved.altBookingNotice) toast.warning("Set updated", { description: saved.altBookingNotice });
      else toast.success("Set updated");
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

  /** A real .ics rather than a button that only looks like one. */
  function addToCalendar() {
    if (!set) return;
    const stamp = (date: string, time: string) =>
      `${date.replace(/-/g, "")}T${formatTime(time).replace(":", "")}00`;
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//FFSA Hub//Prayer Room//EN",
      "BEGIN:VEVENT",
      `UID:prayer-set-${set.id}`,
      `DTSTART:${stamp(set.set_date, set.start_time)}`,
      `DTEND:${stamp(set.set_date, set.end_time)}`,
      `SUMMARY:${(set.title || "Devo set").replace(/\n/g, " ")}`,
      set.prayer_focus ? `DESCRIPTION:${set.prayer_focus.replace(/\n/g, "\\n")}` : "",
      "END:VEVENT",
      "END:VCALENDAR",
    ]
      .filter(Boolean)
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `prayer-set-${set.set_date}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function share() {
    if (!set) return;
    const link = `${window.location.origin}/prayer-room?set=${set.id}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy the link");
    }
  }

  const title = set?.title || set?.theme || "Devo set";

  return (
    <Drawer open={open} onClose={onClose} label="Set detail" onPrev={onPrev} onNext={onNext}>
      {loading || !set ? (
        <p className="mono-label py-16 text-center">{loading ? "Loading…" : "Set not found"}</p>
      ) : editing ? (
        <form action={saveDetails} className="flex flex-1 flex-col">
          <div className="flex-1 space-y-3 px-6 py-5">
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
            <div className="space-y-1">
              <Label className="text-xs">Where</Label>
              <Select value={where} onValueChange={setWhere}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="room">In the prayer room</SelectItem>
                  {!set.alt_venue_id && set.relocation_note && (
                    <SelectItem value="blockout">{set.relocation_note} (moved by a block-out)</SelectItem>
                  )}
                  {altVenues.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {where !== "room" && where !== "blockout" && where !== set.alt_venue_id && (
                <p className="text-[11px] text-muted-foreground">
                  {altVenues.find((v) => v.id === where)?.name ?? "This space"} will be booked in Space Bookings for
                  this set{set.alt_venue_id ? ", and the old space released" : ""}.
                </p>
              )}
              {where === "room" && set.alt_venue_id && (
                <p className="text-[11px] text-muted-foreground">The alternate space booking will be released.</p>
              )}
            </div>
            <Field name="title" label="Title" defaultValue={set.title} />
            <Field name="theme" label="Theme / focus" defaultValue={set.theme} />
            <Field name="scripture" label="Scripture" defaultValue={set.scripture} />
            <div className="space-y-1">
              <Label className="text-xs">What we&apos;re praying</Label>
              <Textarea name="prayer_focus" defaultValue={set.prayer_focus ?? ""} rows={4} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">If you walk in — setlist, notes &amp; links</Label>
              <Textarea name="setlist" defaultValue={set.setlist ?? ""} rows={4} />
            </div>
          </div>
          <div className="flex gap-2 border-t border-surface-4 px-6 py-4">
            <button type="submit" disabled={busy === "save"} className="flex-1 bg-ink px-4 py-3.5 font-mono text-[10.5px] font-bold tracking-[0.14em] text-white">
              SAVE
            </button>
            <button type="button" onClick={() => setEditing(false)} className="border border-ink px-4 py-3.5 font-mono text-[10.5px] font-bold tracking-[0.12em] text-ink">
              CANCEL
            </button>
          </div>
        </form>
      ) : (
        <>
          {/* ── identity ─────────────────────────────── */}
          <div className="border-b border-surface-4 px-6 pb-5 pt-6">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {bandName && (
                <span className="bg-ink px-2.5 py-1 font-display text-[15px] font-black uppercase tracking-[0.02em] text-yellow">
                  {bandName}
                </span>
              )}
              {set.status !== "scheduled" && (
                <span className="border border-rule-strong px-1.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[color:var(--text-secondary)]">
                  {set.status}
                </span>
              )}
              {set.series_id && (
                <span className="border border-rule-strong px-1.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[color:var(--text-secondary)]">
                  Repeats weekly
                </span>
              )}
            </div>
            <h2 className="font-display text-[34px] font-black uppercase leading-[0.94] tracking-[-0.01em] text-ink sm:text-[40px]">
              {title}
            </h2>
            <div className="mt-3.5 flex flex-wrap items-baseline gap-3.5">
              <span className="numeral text-[26px] leading-none">
                {formatTimeRange(set.start_time, set.end_time)}
              </span>
              <span className="font-mono text-[10px] font-bold tracking-[0.12em] text-[color:var(--text-tertiary)]">
                {formatDateLabel(set.set_date).toUpperCase()} · {durationLabel(set.start_time, set.end_time)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9.5px] tracking-[0.1em] text-[color:var(--text-tertiary)]">
              {set.owner && <span>SET UP BY {fullName(set.owner).toUpperCase()}</span>}
              {leadHolders.length > 0 ? (
                <span className="text-ink">
                  LED BY{" "}
                  {leadHolders
                    .map((sl) => displayName(sl.filled).toUpperCase())
                    .join(" & ")}
                </span>
              ) : (
                <span className="text-amber">NO ONE IN A LEAD SEAT YET</span>
              )}
            </div>
          </div>

          {set.relocation_note && (
            <div className="border-b border-surface-4 bg-yellow-dim px-6 py-3 text-[13px] text-ink">
              <span className="font-semibold">Relocated</span> → {set.relocation_note}
            </div>
          )}

          {/* ── what we're praying ───────────────────── */}
          {(set.prayer_focus || set.theme || set.scripture) && (
            <div className="border-b border-surface-4 px-6 py-5">
              <div className="mono-label mb-2.5">What we&apos;re praying</div>
              {set.prayer_focus ? (
                <p className="whitespace-pre-wrap text-[14.5px] leading-[1.55] text-ink">{set.prayer_focus}</p>
              ) : (
                <p className="text-[14.5px] leading-[1.55] text-[color:var(--text-secondary)]">
                  Nothing written for this set yet.
                </p>
              )}
              {(set.theme || set.scripture) && (
                <div className="mt-3.5 flex flex-wrap gap-2">
                  {[set.theme, set.scripture].filter(Boolean).map((t) => (
                    <span
                      key={t}
                      className="border border-rule bg-surface-3 px-2 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[color:var(--text-secondary)]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── the lineup (10b) ─────────────────────── */}
          <div className="border-b border-surface-4">
            <div className="flex items-baseline justify-between px-6 pb-2.5 pt-4">
              <span className="mono-label">The lineup</span>
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-amber">
                {set.slots.length === 0
                  ? "No seats yet"
                  : openCount === 0
                    ? "Full"
                    : `${openCount} ${openCount === 1 ? "seat" : "seats"} open`}
              </span>
            </div>

            {set.slots.length === 0 && (
              <p className="px-6 pb-4 text-[13px] text-[color:var(--text-tertiary)]">
                No seats on this set yet — add the lead seat first, and the set goes live on the wall.
              </p>
            )}

            {leadSlots.map((slot) => (
              <SeatRow
                key={slot.id}
                slot={slot}
                label={seatLabelOf(slot)}
                lead
                userId={userId}
                canManage={canManage}
                busy={busy}
                onFill={() => setFillSlot(slot)}
                onAsk={() => askForSeat(slot)}
                onAction={slotAction}
                onRemove={removeSlot}
              />
            ))}

            {leadSlots.length > 0 && otherSlots.length > 0 && <div className="mx-6 my-2.5 h-0.5 bg-ink" />}

            {otherSlots.map((slot) => (
              <SeatRow
                key={slot.id}
                slot={slot}
                label={seatLabelOf(slot)}
                userId={userId}
                canManage={canManage}
                busy={busy}
                onFill={() => setFillSlot(slot)}
                onAsk={() => askForSeat(slot)}
                onAction={slotAction}
                onRemove={removeSlot}
              />
            ))}

            {canManage && set.status === "scheduled" && (
              <div className="flex items-center gap-2 px-6 pb-4 pt-2">
                <Select value={addRole} onValueChange={setAddRole}>
                  <SelectTrigger className="h-8 w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(seatTypes.length ? seatTypes.map((s) => [s.id, s.label] as const) : ROLES.map((r) => [r, roleLabel(r)] as const)).map(
                      ([id, label]) => (
                        <SelectItem key={id} value={id}>
                          {label}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  disabled={busy === "add"}
                  onClick={addSlot}
                  className="border border-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-ink"
                >
                  + Add seat
                </button>
              </div>
            )}
          </div>

          {/* the lead's inbox for this set */}
          <div className="px-6 py-4 empty:hidden">
            <SeatRequests setId={set.id} canDecide={canManage} onDecided={load} />
          </div>

          {/* ── if you walk in ───────────────────────── */}
          {set.setlist && (
            <div className="border-b border-t border-surface-4 bg-bone px-6 py-5">
              <div className="mono-label mb-2">If you walk in</div>
              <p className="whitespace-pre-wrap text-[13.5px] leading-[1.55] text-ink">{set.setlist}</p>
            </div>
          )}

          {set.owner && (
            <div className="bg-bone px-6 py-4 text-[13px] leading-[1.5] text-[color:var(--text-secondary)]">
              {displayName(set.owner)} set this up. Ask for a seat and they get a notification.
            </div>
          )}

          <div className="flex-1" />

          {/* ── footer ───────────────────────────────── */}
          <div className="border-t border-surface-4 px-6 py-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={addToCalendar}
                className="flex-1 bg-ink px-4 py-3.5 text-center font-mono text-[10.5px] font-bold tracking-[0.14em] text-white"
              >
                ADD TO CALENDAR
              </button>
              <button
                type="button"
                onClick={share}
                className="border border-ink px-4 py-3.5 font-mono text-[10.5px] font-bold tracking-[0.12em] text-ink"
              >
                SHARE
              </button>
            </div>

            {canManage && (
              <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-4 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">
                  {set.status === "scheduled" && (
                    <button type="button" onClick={() => setEditing(true)} className="border-b border-rule-strong">
                      Edit set
                    </button>
                  )}
                  {set.status === "scheduled" && !set.series_id && (
                    <button type="button" onClick={() => setRepeating(true)} className="border-b border-rule-strong">
                      Repeat weekly
                    </button>
                  )}
                  {set.status === "scheduled" && (
                    <>
                      <button
                        type="button"
                        disabled={busy === "complete"}
                        onClick={() => setStatus("complete")}
                        className="border-b border-rule-strong"
                      >
                        Mark complete
                      </button>
                      <button
                        type="button"
                        disabled={busy === "cancel"}
                        onClick={() => setStatus("cancel")}
                        className="border-b border-rule-strong text-[color:var(--destructive)]"
                      >
                        Cancel set
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <SeatFill
            open={!!fillSlot}
            onClose={() => setFillSlot(null)}
            seatTypeId={fillSlot?.seat_type_id ?? fillSlot?.role ?? null}
            seatLabel={fillSlot ? seatLabelOf(fillSlot) : undefined}
            setContext={`${(set.title || "Devo set").toUpperCase()} · ${formatDateLabel(set.set_date).toUpperCase()} ${formatTimeRange(set.start_time, set.end_time)}`}
            setId={set.id}
            busyId={busy}
            onPick={(uid) => invite(uid)}
          />

          <RepeatWeeklyDialog
            open={repeating}
            onClose={() => setRepeating(false)}
            setId={set.id}
            setDate={set.set_date}
            onDone={refresh}
          />
        </>
      )}
    </Drawer>
  );
}

/* ── one seat in the lineup ─────────────────────────── */
function SeatRow({
  slot,
  label,
  lead,
  userId,
  canManage,
  busy,
  onFill,
  onAsk,
  onAction,
  onRemove,
}: {
  slot: Slot;
  label: string;
  lead?: boolean;
  userId: string;
  canManage: boolean;
  busy: string | null;
  onFill: () => void;
  onAsk: () => void;
  onAction: (slotId: string, body: Record<string, unknown>) => void;
  onRemove: (slotId: string) => void;
}) {
  const empty = slot.status === "open" || slot.status === "declined";
  const mine = slot.invitee_id === userId;

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-6",
        lead ? "py-2" : "border-b border-surface-3 py-2.5"
      )}
    >
      <span
        className={cn(
          "shrink-0",
          lead
            ? "w-[88px] font-display text-[15px] font-black uppercase leading-tight text-ink"
            : "w-[74px] font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--text-tertiary)]"
        )}
      >
        {label}
      </span>

      {empty ? (
        <div className="flex min-w-0 flex-1 items-center justify-between gap-2.5 border border-dashed border-rule-strong px-2.5 py-2">
          <span className="truncate text-[13px] font-semibold text-[color:var(--text-tertiary)]">
            Nobody in this seat yet
            {slot.required_label ? ` · ${slot.required_label.name}` : ""}
          </span>
          <button
            type="button"
            disabled={busy === slot.id}
            onClick={canManage ? onFill : onAsk}
            className={cn(
              "shrink-0 border border-ink px-1.5 py-1 font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-ink",
              canManage ? "bg-white hover:bg-bone" : "bg-yellow"
            )}
          >
            {canManage ? "Fill seat" : "Ask to join"}
          </button>
        </div>
      ) : (
        <div
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2.5",
            lead && "border border-ink bg-surface-3 px-2.5 py-1.5"
          )}
        >
          <Initials name={fullName(slot.status === "filled" ? slot.filled : slot.invitee)} size={lead ? 26 : 28} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-bold text-ink">
              {displayName(slot.status === "filled" ? slot.filled : slot.invitee)}
            </div>
            {slot.status === "invited" && (
              <div className="font-mono text-[8.5px] uppercase tracking-[0.08em] text-[color:var(--text-quiet)]">
                Invited — not confirmed
              </div>
            )}
          </div>

          {slot.status === "invited" && mine && (
            <div className="flex shrink-0 gap-1.5">
              <button
                type="button"
                disabled={busy === slot.id}
                onClick={() => onAction(slot.id, { action: "accept" })}
                className="bg-ink px-2 py-1 font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-white"
              >
                Accept
              </button>
              <button
                type="button"
                disabled={busy === slot.id}
                onClick={() => onAction(slot.id, { action: "decline" })}
                className="border border-rule-strong px-2 py-1 font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-[color:var(--text-secondary)]"
              >
                Decline
              </button>
            </div>
          )}

          {canManage && !mine && (
            <button
              type="button"
              disabled={busy === slot.id}
              onClick={() => onAction(slot.id, { action: "vacate" })}
              className="shrink-0 font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-[color:var(--text-tertiary)] hover:text-ink"
            >
              Remove
            </button>
          )}
        </div>
      )}

      {canManage && (
        <button
          type="button"
          title="Delete this seat"
          disabled={busy === slot.id}
          onClick={() => onRemove(slot.id)}
          className="shrink-0 px-1 font-mono text-[11px] text-[color:var(--text-quiet)] hover:text-ink"
        >
          ✕
        </button>
      )}
    </div>
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
    <Drawer open={open} onClose={onClose} label="Repeat weekly">
      <div className="flex-1 space-y-4 px-6 py-5">
        <p className="text-[13.5px] leading-[1.55] text-[color:var(--text-secondary)]">
          This set repeats every week on the same day and time until the date you choose. The set
          you&apos;re looking at stays as the first week.
        </p>
        <div className="space-y-1">
          <Label className="text-xs">Runs until</Label>
          <Input type="date" value={seriesEnd} onChange={(e) => setSeriesEnd(e.target.value)} />
        </div>
        <div className="border border-rule bg-bone p-3">
          <div className="flex gap-1.5">
            {([true, false] as const).map((v) => (
              <button
                key={String(v)}
                type="button"
                onClick={() => setKeepTeam(v)}
                className={cn(
                  "flex-1 px-2 py-2.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.08em]",
                  keepTeam === v ? "bg-ink text-white" : "border border-rule-strong text-[color:var(--text-secondary)]"
                )}
              >
                {v ? "Keep this team" : "Open seats each week"}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-[color:var(--text-tertiary)]">
            {keepTeam
              ? "Each new week invites the same people into the same seats."
              : "Each new week repeats the same seats, all open."}
          </p>
        </div>
      </div>
      <div className="border-t border-surface-4 px-6 py-4">
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="w-full bg-ink px-4 py-3.5 font-mono text-[10.5px] font-bold tracking-[0.14em] text-white"
        >
          {busy ? "CREATING…" : "CREATE WEEKLY SERIES"}
        </button>
      </div>
    </Drawer>
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
