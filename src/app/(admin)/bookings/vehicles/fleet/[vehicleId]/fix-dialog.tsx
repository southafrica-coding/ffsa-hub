"use client";

// "Mark as fixed" on a Fix now or Monitor point (Gideon, 23 and 25 Nov 2026): the date it was fixed, who fixed
// it (a person or a workshop) and a short description of the work. The point goes back to
// OK as of that date; the next inspection that checks it overrides it as usual.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FIX_LIMITS } from "@/lib/fleet/fixes";
import { fmtDate } from "@/lib/fleet/rules/format";
import { ActionButton } from "../_components/ui";
import { fleetFetch } from "../_components/client-api";
import { F, field } from "./form-bits";

export function MarkFixedButton({
  vehicleId,
  itemId,
  point,
  foundOn,
  today,
}: {
  vehicleId: string;
  itemId: string;
  /** The checklist point, e.g. "Ball joints and control arms". */
  point: string;
  /** The day it was found (the earliest it can have been fixed). */
  foundOn?: string;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [by, setBy] = useState("");
  const [work, setWork] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!by.trim()) return toast.error("Say who fixed it.");
    if (!work.trim()) return toast.error("Say what was done.");
    setSaving(true);
    try {
      const r = await fleetFetch<{ message: string }>(`/api/vehicles/fleet/vehicles/${vehicleId}/fixed`, { body: { itemId, date, by: by.trim(), work: work.trim() } });
      toast.success(r.message);
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <ActionButton onClick={() => setOpen(true)}>Mark as fixed</ActionButton>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Mark as fixed</DialogTitle>
            </DialogHeader>
            <p className="text-[14px] text-[#55524A]">
              <strong className="text-ink">{point}</strong>
              {foundOn ? `: marked Fix now on ${fmtDate(foundOn)}.` : "."} It goes back to OK from the date it was fixed.
            </p>
            <div className="grid gap-4">
              <F label="Date it was fixed">
                <input className={field} type="date" value={date} min={foundOn} max={today} onChange={(e) => setDate(e.target.value)} />
              </F>
              <F label="Fixed by" hint="The person or workshop that did the work.">
                <input className={field} value={by} maxLength={FIX_LIMITS.by} placeholder="e.g. Motech" onChange={(e) => setBy(e.target.value)} />
              </F>
              <F label="What was done">
                <textarea
                  className={field}
                  rows={3}
                  value={work}
                  maxLength={FIX_LIMITS.work}
                  placeholder="e.g. Replaced all four lower control arm bushes."
                  onChange={(e) => setWork(e.target.value)}
                />
              </F>
            </div>
            <DialogFooter className="gap-2">
              <ActionButton onClick={() => setOpen(false)}>Cancel</ActionButton>
              <ActionButton tone="solid" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </ActionButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
