"use client";

// The vehicle header's interactive pieces: status, photo, Start inspection / Continue
// draft, Log km and Issue list for workshop.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils/cn";
import { ActionButton, FLEET } from "../_components/ui";
import { fleetFetch, uploadFleetFile } from "../_components/client-api";
import { KmDialog, type KmVehicle } from "../_components/km-dialog";
import { field } from "./form-bits";
import { draftChecked, draftKey } from "./model";

const btn = "inline-flex min-h-11 items-center justify-center border px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em]";

/** Status (changeable): saves the status and sets statusSince to today. */
export function StatusSelect({ vehicleId, status, statuses, today }: { vehicleId: string; status: string; statuses: string[]; today: string }) {
  const router = useRouter();
  const [value, setValue] = useState(status);
  const [saving, setSaving] = useState(false);
  useEffect(() => setValue(status), [status]);

  async function change(next: string) {
    const prev = value;
    setValue(next);
    setSaving(true);
    try {
      await fleetFetch(`/api/vehicles/fleet/vehicles/${vehicleId}`, { method: "PATCH", body: { patch: { status: next, statusSince: today } } });
      toast.success("Status updated.");
      router.refresh();
    } catch (e) {
      setValue(prev);
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <select aria-label="Vehicle status" className={cn(field, "w-full sm:max-w-[260px]")} value={value} disabled={saving} onChange={(e) => change(e.target.value)}>
      {statuses.map((s) => (
        <option key={s}>{s}</option>
      ))}
    </select>
  );
}

/** "Add photo" / "Change photo" under the vehicle's photo. */
export function PhotoChange({ vehicleId, hasPhoto }: { vehicleId: string; hasPhoto: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const r = await uploadFleetFile(file, { type: "vehicle", id: vehicleId });
      await fleetFetch(`/api/vehicles/fleet/vehicles/${vehicleId}`, { method: "PATCH", body: { patch: { photo: r.id } } });
      toast.success("Photo saved.");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <label className={cn(btn, "w-full cursor-pointer border-ink bg-white hover:bg-bone", busy && "opacity-50")}>
      {busy ? "Uploading…" : hasPhoto ? "Change photo" : "Add photo"}
      <input
        type="file"
        accept="image/*"
        hidden
        disabled={busy}
        onChange={(e) => {
          upload(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </label>
  );
}

/** Start inspection, or Continue draft (n checked) when this device holds a draft. */
export function InspectButton({ vehicleId }: { vehicleId: string }) {
  const [draft, setDraft] = useState<{ n: number | null; has: boolean }>({ n: null, has: false });
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(draftKey(vehicleId));
    } catch {
      raw = null;
    }
    setDraft({ has: !!raw, n: draftChecked(raw) });
  }, [vehicleId]);
  const solid = cn(btn, "border-ink bg-ink text-white hover:bg-[#262622] hover:text-white");
  if (!draft.has)
    return (
      <Link href={`${FLEET}/${vehicleId}/inspect`} className={solid}>
        Start inspection
      </Link>
    );
  // As the app: continue the draft, or start over after a confirm (?new=1 discards it).
  return (
    <>
      <Link href={`${FLEET}/${vehicleId}/inspect`} className={solid}>
        {`Continue draft${draft.n !== null ? ` (${draft.n} checked)` : ""}`}
      </Link>
      <button
        type="button"
        className={cn(btn, "border-ink bg-white text-ink hover:bg-bone")}
        onClick={() => {
          if (window.confirm("There is an unsaved draft inspection for this vehicle on this device. Start over and discard it?"))
            window.location.href = `${FLEET}/${vehicleId}/inspect?new=1`;
        }}
      >
        Start new
      </button>
    </>
  );
}

export function LogKmButton({ vehicle, today }: { vehicle: KmVehicle; today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ActionButton onClick={() => setOpen(true)}>Log km</ActionButton>
      <KmDialog open={open} onOpenChange={setOpen} vehicle={vehicle} today={today} />
    </>
  );
}

/** Issue list for workshop (copy-issues → copyModal). */
export function IssueListButton({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied.");
    } catch {
      const ta = document.getElementById("fleet-issue-text") as HTMLTextAreaElement | null;
      ta?.focus();
      ta?.select();
      toast("Press Ctrl+C (or long-press and Copy) to copy the selected text.");
    }
  }
  return (
    <>
      <ActionButton onClick={() => setOpen(true)}>Issue list for workshop</ActionButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Issue list for the workshop</DialogTitle>
          </DialogHeader>
          <p className="text-[12px] text-[#55524A]">Paste this into WhatsApp, Slack or an email to the workshop.</p>
          <textarea id="fleet-issue-text" readOnly value={text} rows={14} className={cn(field, "font-mono text-[13px]")} />
          <DialogFooter className="gap-2">
            <ActionButton onClick={() => setOpen(false)}>Close</ActionButton>
            <ActionButton tone="solid" onClick={copy}>
              Copy text
            </ActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** "Mark done" on a follow-up (the reference's clear-followup). */
export function ClearFollowUpButton({ vehicleId }: { vehicleId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function clear() {
    setBusy(true);
    try {
      await fleetFetch(`/api/vehicles/fleet/vehicles/${vehicleId}`, { method: "PATCH", body: { patch: { followUp: null } } });
      toast.success("Follow-up marked done.");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" onClick={clear} disabled={busy} className="min-h-11 underline disabled:opacity-50">
      Mark done
    </button>
  );
}
