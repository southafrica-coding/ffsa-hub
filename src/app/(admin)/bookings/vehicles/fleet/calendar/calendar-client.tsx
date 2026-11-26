"use client";

// "Find a free 48 hours for" under Book a workshop visit on the booking board (the Fleet
// app's gap-v / gap-out). The free 48 hours come precomputed from the server, so nothing
// here works out a rule.

import { useState } from "react";
import { fmtRange } from "@/lib/fleet/rules/format";
import { VisitButton, type VisitCtx } from "../[vehicleId]/visit-dialog";
import { bookPrefill, type GapChoice } from "./model";

export interface BookCtx {
  ctx: VisitCtx;
  /** The workshop the app suggests (lastProvider). */
  provider: string;
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
