"use client";

// The Calendar's interactive bits: "Book a workshop visit" in the header (the Fleet app's
// 'book-pick': choose the vehicle, each with its first free 48 hours, then the booking form)
// and "Find a free 48 hours for" (the app's gap-v / gap-out). The free 48 hours come
// precomputed from the server, so nothing here works out a rule.

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MastheadButton } from "@/components/ffsa";
import { fmtRange } from "@/lib/fleet/rules/format";
import { VisitButton, VisitDialog, type VisitCtx } from "../[vehicleId]/visit-dialog";
import { bookPrefill, type GapChoice } from "./model";

export interface BookCtx {
  ctx: VisitCtx;
  /** The workshop the app suggests (lastProvider). */
  provider: string;
}

export function BookPickButton({ choices, ctxs }: { choices: GapChoice[]; ctxs: Record<string, BookCtx> }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<GapChoice | null>(null);
  const b = picked && ctxs[picked.id];
  return (
    <>
      <MastheadButton tone="outline" onClick={() => setOpen(true)}>
        Book a workshop visit
      </MastheadButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Book a workshop visit</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-[#55524A]">Choose the vehicle. The booking form suggests the first free 48 hours.</p>
          <ul className="divide-y divide-rule border-y border-rule">
            {choices.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setPicked(c);
                  }}
                  className="flex min-h-11 w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left hover:bg-bone"
                >
                  <b className="text-[15px]">{c.name}</b>
                  <span className="text-[13px] text-[#55524A]">{c.gap ? "First free 48 hours: " + fmtRange(c.gap.from, c.gap.to) : "No free 48 hours soon"}</span>
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
      {picked && b && <VisitDialog ctx={b.ctx} mode="book" prefill={bookPrefill(picked, b.provider, b.ctx.today)} onClose={() => setPicked(null)} />}
    </>
  );
}

const field = "min-h-11 w-full border border-rule-strong bg-white px-3 py-2 text-[15px] focus:border-ink focus:outline-none sm:w-auto sm:min-w-[220px]";

export function GapFinder({ choices, ctxs, canWrite }: { choices: GapChoice[]; ctxs: Record<string, BookCtx>; canWrite: boolean }) {
  const [vid, setVid] = useState("");
  const c = choices.find((x) => x.id === vid);
  const b = c && ctxs[c.id];
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      <label className="grid gap-1.5">
        <span className="mono-label">Find a free 48 hours for</span>
        <select className={field} value={vid} onChange={(e) => setVid(e.target.value)}>
          <option value="">Choose a vehicle</option>
          {choices.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      {c && (
        <div className="flex flex-wrap items-center gap-3 text-[14px]" aria-live="polite">
          {c.gap ? (
            <>
              <span>
                First free 48 hours: <strong>{fmtRange(c.gap.from, c.gap.to)}</strong>
              </span>
              {canWrite && b && (
                <VisitButton key={c.id} ctx={b.ctx} mode="book" prefill={bookPrefill(c, b.provider, b.ctx.today)} tone="solid">
                  Book it
                </VisitButton>
              )}
            </>
          ) : (
            <span>No free 48 hours in the next few months.</span>
          )}
        </div>
      )}
    </div>
  );
}
