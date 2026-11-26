"use client";

// "Download report": the vehicle's history for any period as a PDF (Gideon, 23 Nov 2026).

import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ActionButton } from "../_components/ui";
import { F, field } from "./form-bits";

/** From 1 Dec 2026 (when Fleet's history starts being kept in the Hub) once that's past;
 *  before then, from the start of this year. */
export const defaultReportFrom = (today: string) => (today >= "2026-12-01" ? "2026-12-01" : `${today.slice(0, 4)}-01-01`);

export function ReportButton({ vehicleId, vehicleName, today }: { vehicleId: string; vehicleName: string; today: string }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(defaultReportFrom(today));
  const [to, setTo] = useState(today);
  const ok = !!from && !!to && from <= to;
  const href = `/api/vehicles/fleet/vehicles/${vehicleId}/report?from=${from}&to=${to}`;
  return (
    <>
      <ActionButton onClick={() => setOpen(true)}>Download report</ActionButton>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Vehicle history report</DialogTitle>
            </DialogHeader>
            <p className="text-[14px] text-[#55524A]">
              Everything done to <strong className="text-ink">{vehicleName}</strong> in the period, as a PDF: services, repairs and other workshop visits with their
              costs, inspections and what they found, fixes, bookings and km readings, with a summary and the issues still open.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <F label="From">
                <input className={field} type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} />
              </F>
              <F label="To">
                <input className={field} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
              </F>
            </div>
            {!ok && <p className="text-[13px] text-destructive">Choose a start date on or before the end date.</p>}
            <DialogFooter className="gap-2">
              <ActionButton onClick={() => setOpen(false)}>Cancel</ActionButton>
              {ok ? (
                <a
                  href={href}
                  download
                  onClick={() => setTimeout(() => setOpen(false), 300)}
                  className="inline-flex min-h-11 items-center justify-center border border-ink bg-ink px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white hover:bg-[#262622] hover:text-white"
                >
                  Download PDF
                </a>
              ) : (
                <ActionButton tone="solid" disabled>
                  Download PDF
                </ActionButton>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
