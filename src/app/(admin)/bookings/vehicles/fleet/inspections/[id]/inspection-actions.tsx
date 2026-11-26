"use client";

// Copy report text (the Fleet app's copyModal) and Delete (delete-insp: the vehicle's
// condition is recalculated from the remaining inspections).

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ActionButton, vehicleHref } from "../../_components/ui";
import { fleetFetch } from "../../_components/client-api";

export function InspectionActions({ id, vehicleId, report, canDelete }: { id: string; vehicleId: string; report: string; canDelete: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const ta = useRef<HTMLTextAreaElement | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(report);
      toast.success("Copied.");
    } catch {
      ta.current?.focus();
      ta.current?.select();
      toast("Press Ctrl+C (or long-press and Copy) to copy the selected text.");
    }
  }

  async function del() {
    if (!window.confirm("Delete this inspection? The vehicle’s condition will be recalculated from the remaining inspections.")) return;
    setDeleting(true);
    try {
      await fleetFetch(`/api/vehicles/fleet/inspections/${id}`, { method: "DELETE" });
      toast.success("Inspection deleted.");
      router.push(vehicleHref(vehicleId));
    } catch (e) {
      toast.error((e as Error).message);
      setDeleting(false);
    }
  }

  return (
    <>
      <ActionButton tone="solid" onClick={() => setOpen(true)}>
        Copy report text
      </ActionButton>
      {canDelete && (
        <ActionButton onClick={del} disabled={deleting}>
          {deleting ? "Deleting…" : "Delete"}
        </ActionButton>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Inspection report</DialogTitle>
          </DialogHeader>
          <textarea
            ref={ta}
            readOnly
            rows={12}
            value={report}
            className="w-full border border-rule-strong bg-white px-3 py-2 font-mono text-[13px] focus:border-ink focus:outline-none"
          />
          <DialogFooter className="gap-2">
            <ActionButton onClick={() => setOpen(false)}>Close</ActionButton>
            <ActionButton tone="solid" onClick={copy}>
              Copy
            </ActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
