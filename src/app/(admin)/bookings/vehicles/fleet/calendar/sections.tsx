// The Calendar's sections (the Fleet app's calendarView), drawn from model.ts. No hooks
// here; the buttons inside are client components.

import Link from "next/link";
import { SectionBar } from "@/components/ffsa";
import { cn } from "@/lib/utils/cn";
import { MoveTripButton } from "../_components/task-actions";
import { SevDot, sevLabel, vehicleHref } from "../_components/ui";
import { VisitButton } from "../[vehicleId]/visit-dialog";
import { fmtRange } from "@/lib/fleet/rules/format";
import { GapFinder, type BookCtx } from "./calendar-client";
import { bookPrefill, type CalCell, type CalGrid, type ClashItem, type DueItem, type GapChoice, type ListItem } from "./model";

const pad = "px-5 md:px-8";
const muted = "text-[13px] text-[#55524A]";

// Data marks, square like every mark in the Hub: trips blue, workshop visits amber, clashes red.
const MARK: Record<string, string> = { trip: "bg-electric/35", ws: "bg-amber-border/70", clash: "bg-destructive" };
const ring = "inline-block h-[11px] w-[11px] border-2 align-middle";
const CHECK: Record<string, string> = { plan: "border-grass", done: "border-grass bg-grass", late: "border-destructive" };

// ── Timeline ───────────────────────────────────────────────

function Cell({ c }: { c: CalCell }) {
  return (
    <td title={c.tip || undefined} className={cn("h-9 w-[30px] min-w-[30px] border-b border-rule p-0 text-center", c.weekend && "bg-bone", c.today && "bg-yellow-dim")}>
      {c.mark && <span aria-hidden className={cn("block h-5", c.mark.s && "ml-[3px]", c.mark.e && "mr-[3px]", MARK[c.mark.c])} />}
      {!c.mark && c.check && <span aria-hidden className={cn(ring, CHECK[c.check])} />}
      {c.tip && <span className="sr-only">{c.tip}</span>}
    </td>
  );
}

/** Four weeks, a row per vehicle. Scrolls sideways inside its own box (the page never
 *  does), with the vehicle names held on the left. */
export function Timeline({ grid }: { grid: CalGrid }) {
  const vn = "sticky left-0 z-[2] w-[104px] min-w-[104px] max-w-[104px] border-b border-r border-rule bg-white px-2.5 text-left md:w-[150px] md:min-w-[150px] md:max-w-[150px]";
  return (
    <div className="max-w-full overflow-x-auto border-y border-rule" role="region" aria-label="Four-week timeline" tabIndex={0}>
      <table className="border-separate border-spacing-0 text-[12px]">
        <thead>
          <tr>
            <th scope="col" className={cn(vn, "mono-label h-[42px]")}>
              Vehicle
            </th>
            {grid.days.map((d) => (
              <th
                key={d.date}
                scope="col"
                className={cn(
                  "h-[42px] w-[30px] min-w-[30px] border-b border-rule p-0 text-center font-mono text-[10px] font-bold uppercase leading-tight",
                  d.weekend ? "bg-bone text-[#7C786C]" : "text-[#55524A]",
                  d.today && "bg-ink text-white"
                )}
              >
                {d.dow}
                <b className={cn("block font-display text-[14px] font-black tabular-nums", d.today ? "text-white" : "text-ink")}>{d.num}</b>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" className={cn(vn, "h-9 text-[12px] font-medium leading-tight md:text-[13px]")}>
                {/* Wraps rather than cutting off: "Hyundai H1 #1" and "#2" must stay tellable apart on a phone. */}
                <Link href={vehicleHref(r.id)} title={r.name} className="block break-words py-1.5">
                  {r.name}
                </Link>
              </th>
              {r.cells.map((c) => (
                <Cell key={c.date} c={c} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Legend() {
  const sw = "inline-block h-2.5 w-[18px]";
  return (
    <div className={cn("flex flex-wrap gap-x-4 gap-y-1.5 py-3 text-[12px] text-[#55524A]", pad)}>
      <span className="inline-flex items-center gap-1.5">
        <i className={cn(sw, MARK.trip)} />
        Trip or rental
      </span>
      <span className="inline-flex items-center gap-1.5">
        <i className={cn(sw, MARK.ws)} />
        Workshop visit
      </span>
      <span className="inline-flex items-center gap-1.5">
        <i className={cn(sw, MARK.clash)} />
        Clash
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className={cn(ring, CHECK.plan)} />
        Inspection day
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className={cn(ring, CHECK.done)} />
        Checked
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className={cn(ring, CHECK.late)} />
        Overdue
      </span>
    </div>
  );
}

// ── Clashes and heads-ups ──────────────────────────────────

export function ClashSection({ items, ctxs, canWrite }: { items: ClashItem[]; ctxs: Record<string, BookCtx>; canWrite: boolean }) {
  return (
    <section aria-label="Clashes and heads-ups">
      <SectionBar title="Clashes and heads-ups" meta={items.length ? String(items.length) : undefined} />
      {items.length ? (
        <ul className="divide-y divide-rule">
          {items.map((c, i) => {
            const b = ctxs[c.vehicleId];
            const acts = canWrite && (c.moves.length > 0 || (c.wsMove && b));
            return (
              <li key={i} className={cn("flex gap-3 py-3 text-[14px] leading-snug", pad)}>
                <SevDot sev={c.sev} />
                <div className="min-w-0 flex-1">
                  <span className="sr-only">{sevLabel(c.sev)}: </span>
                  <strong>{c.vehicleName}</strong> · {c.text}
                  {c.note && <p className={cn("mt-0.5", muted)}>{c.note}</p>}
                  {acts && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {c.moves.map((m) => (
                        <MoveTripButton key={m.to.id} trip={m.trip} to={m.to} />
                      ))}
                      {c.wsMove && b && (
                        <VisitButton ctx={b.ctx} mode="edit" visit={c.wsMove.visit} prefill={{ date: c.wsMove.from, until: c.wsMove.to }} className="text-left">
                          Move the workshop visit to {fmtRange(c.wsMove.from, c.wsMove.to)}
                        </VisitButton>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={cn("py-4 text-[14px]", pad)}>No clashes. Every workshop visit fits around the trips and rentals.</p>
      )}
      <p className={cn("border-t border-rule py-3", pad, muted)}>
        A clash is a workshop visit on the same day as a trip or rental, or two bookings on one vehicle. A heads-up is a trip that starts within 7 days after a workshop
        visit.
      </p>
    </section>
  );
}

// ── Book a workshop visit ──────────────────────────────────

export function BookSection({
  due,
  noneDue,
  missing,
  choices,
  ctxs,
  canWrite,
}: {
  due: DueItem[];
  noneDue: string;
  missing: string;
  choices: GapChoice[];
  ctxs: Record<string, BookCtx>;
  canWrite: boolean;
}) {
  return (
    <section aria-label="Book a workshop visit">
      <SectionBar title="Book a workshop visit" meta={due.length ? String(due.length) : undefined} />
      {due.length ? (
        <ul className="divide-y divide-rule">
          {due.map((x) => {
            const b = ctxs[x.id];
            return (
              <li key={x.id} className={cn("flex flex-col gap-3 py-3 sm:flex-row sm:items-start", pad)}>
                <div className="flex min-w-0 flex-1 gap-3">
                  <SevDot sev={x.sev} />
                  <div className="min-w-0 text-[14px] leading-snug">
                    <span className="sr-only">{sevLabel(x.sev)}: </span>
                    <Link href={vehicleHref(x.id)} className="font-bold underline-offset-2 hover:underline">
                      {x.name}
                    </Link>
                    <p>{x.text}</p>
                    <p className={cn("mt-0.5", muted)}>{x.when}</p>
                  </div>
                </div>
                {canWrite && b && (
                  <VisitButton ctx={b.ctx} mode="book" prefill={bookPrefill(x, b.provider, b.ctx.today)} tone="solid" className="shrink-0 self-start">
                    Book
                  </VisitButton>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={cn("py-4 text-[14px]", pad)}>{noneDue}</p>
      )}
      {missing && <p className={cn("border-t border-rule py-3", pad, muted)}>{missing}</p>}
      <div className={cn("border-t border-rule py-4", pad)}>
        <GapFinder choices={choices} ctxs={ctxs} canWrite={canWrite} />
      </div>
    </section>
  );
}

// ── List view ──────────────────────────────────────────────

export function ListSection({ items }: { items: ListItem[] }) {
  return (
    <section aria-label="List view">
      <SectionBar title="List view" meta={items.length ? String(items.length) : undefined} />
      {items.length ? (
        <ul className="divide-y divide-rule border-b border-rule">
          {items.map((x, i) => (
            <li key={i} className={cn("flex gap-3 py-3 text-[14px] leading-snug", pad)}>
              <SevDot sev={x.dot} className={x.dot === "info" ? "bg-electric/35" : undefined} />
              <span className="min-w-0 flex-1">
                <Link href={vehicleHref(x.vehicleId)} className="font-medium underline-offset-2 hover:underline">
                  {x.vehicleName}
                </Link>
                <span className="text-[#55524A]"> · {x.text}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={cn("border-b border-rule py-4 text-[14px]", pad)}>Nothing booked in these four weeks.</p>
      )}
    </section>
  );
}
