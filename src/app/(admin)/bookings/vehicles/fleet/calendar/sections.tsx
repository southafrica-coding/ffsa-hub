// Fleet's sections on the booking board (one calendar, Fleet 5b–5d): clashes and heads-ups,
// Book a workshop visit, and Out of action. Drawn from model.ts and out-of-action.ts. No
// hooks here; the buttons inside are client components.

import Link from "next/link";
import { SectionBar } from "@/components/ffsa";
import { cn } from "@/lib/utils/cn";
import { MoveTripButton, NotifyBookerButton, OutOfActionButton, VehicleOutButtons } from "../_components/task-actions";
import { LOOK_AHEAD_DAYS, bookingLine, outLine, type OutVehicle, type ResumeItem } from "@/lib/fleet/out-of-action";
import { SevDot, sevLabel, vehicleHref } from "../_components/ui";
import { VisitButton } from "../[vehicleId]/visit-dialog";
import { fmtRange } from "@/lib/fleet/rules/format";
import { GapFinder, type BookCtx } from "./calendar-client";
import { bookPrefill, type ClashItem, type DueItem, type GapChoice } from "./model";

const pad = "px-5 md:px-8";
const muted = "text-[13px] text-[#55524A]";

// ── Clashes and heads-ups ──────────────────────────────────

export function ClashSection({ items, ctxs, canWrite }: { items: ClashItem[]; ctxs: Record<string, BookCtx>; canWrite: boolean }) {
  return (
    <section aria-label="Clashes and heads-ups">
      <SectionBar title="Clashes and heads-ups" meta={items.length ? String(items.length) : undefined} />
      {items.length ? (
        <ul className="divide-y divide-rule">
          {items.map((c, i) => {
            const b = ctxs[c.vehicleId];
            const acts = canWrite && (c.moves.length > 0 || (c.wsMove && b) || c.notify);
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
                      {c.notify && <NotifyBookerButton bookingId={c.notify.bookingId} visitId={c.notify.visitId} text={c.notify.text} />}
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

// ── Out of action (Fleet 5c) ───────────────────────────────

/** Vehicles in for a repair or broken down, with every booking on them under way or in the
 *  next 10 days and what can be done about it; then bookings on hold whose vehicle is back. */
export function OutOfActionSection({ vehicles, resume, canWrite, today }: { vehicles: OutVehicle[]; resume: ResumeItem[]; canWrite: boolean; today: string }) {
  if (!vehicles.length && !resume.length) return null;
  return (
    <section aria-label="Out of action">
      <SectionBar title="Out of action" meta={String(vehicles.length + resume.length)} />
      <ul className="divide-y divide-rule">
        {vehicles.map((o) => (
          <li key={o.id} className={cn("py-3 text-[14px] leading-snug", pad)}>
            <div className="flex gap-3">
              <SevDot sev={o.kind === "breakdown" ? "crit" : "warn"} />
              <div className="min-w-0 flex-1">
                <Link href={vehicleHref(o.id)} className="font-bold underline-offset-2 hover:underline">
                  {o.name}
                </Link>
                <p>{outLine(o)}</p>
                {canWrite && (
                  <div className="mt-2">
                    <VehicleOutButtons vehicleId={o.id} vehicleName={o.name} status={o.kind === "repair" ? "In workshop" : "Off the road"} today={today} />
                  </div>
                )}
                {o.bookings.length ? (
                  <ul className="mt-3 space-y-3 border-l-2 border-rule pl-3">
                    {o.bookings.map((b) => (
                      <li key={b.bookingId}>
                        <Link href={`/bookings/vehicles/${b.bookingId}`} className="font-semibold underline-offset-2 hover:underline">
                          {bookingLine(b)}
                        </Link>
                        {b.swaps.length ? (
                          <p className={muted}>Free {b.swaps.length === 1 ? "vehicle" : "vehicles"} of the same class for the rest of it: {b.swaps.map((x) => x.name).join(", ")}. The team keeps the one you choose.</p>
                        ) : (
                          <p className={muted}>
                            No vehicle of the same class is free for the rest of it.{" "}
                            {o.kind === "repair" ? "Put it on hold until this one’s back, or cancel it." : "Cancel it so they can make other plans, or put it on hold if it might be back in time."}
                          </p>
                        )}
                        {canWrite && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {b.swaps.map((x) => (
                              <MoveTripButton key={x.id} trip={b.trip} to={x} />
                            ))}
                            {!b.swaps.length && !b.onHold && (
                              <OutOfActionButton
                                action="hold"
                                bookingId={b.bookingId}
                                label="Put on hold"
                                confirm={`Put ${b.label} on hold until ${o.name} is back? The person who booked gets a message saying so.`}
                              />
                            )}
                            {!b.swaps.length && (
                              <OutOfActionButton
                                action="cancel"
                                bookingId={b.bookingId}
                                label="Cancel: vehicle broke down"
                                confirm={`Cancel ${b.label}? The person who booked gets a message that the vehicle broke down and nothing similar is free.`}
                              />
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={cn("mt-1", muted)}>No bookings on it in the next {LOOK_AHEAD_DAYS} days.</p>
                )}
              </div>
            </div>
          </li>
        ))}
        {resume.map((r) => (
          <li key={r.bookingId} className={cn("flex gap-3 py-3 text-[14px] leading-snug", pad)}>
            <SevDot sev="warn" />
            <div className="min-w-0 flex-1">
              <Link href={`/bookings/vehicles/${r.bookingId}`} className="font-bold underline-offset-2 hover:underline">
                {r.label}
              </Link>
              <p>
                On hold since {fmtRange(r.onHold, null)}. {r.vehicleName} is back in service.
              </p>
              {canWrite && (
                <div className="mt-2">
                  <OutOfActionButton action="resume" bookingId={r.bookingId} label="Resume booking" confirm={`Take ${r.label} off hold? The person who booked gets a message that ${r.vehicleName} is back.`} />
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className={cn("border-t border-rule py-3", pad, muted)}>
        While a vehicle is out of action it can’t be booked. Its bookings for the next {LOOK_AHEAD_DAYS} days are listed here as they come up. Every button tells the person who booked.
      </p>
    </section>
  );
}
