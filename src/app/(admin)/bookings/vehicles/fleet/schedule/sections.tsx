// The Schedule screen's sections (the Fleet app's board, kmPanel, the workshop and trip
// lists, and the co-ordinator panel). No hooks of their own, so they render on the server
// and in tests; the controls inside are client components.

import Link from "next/link";
import { SectionBar, StatusPill } from "@/components/ffsa";
import type { Coordinator } from "@/lib/fleet/load";
import { fmtDate, fmtDay } from "@/lib/fleet/rules/format";
import { cn } from "@/lib/utils/cn";
import { StartButton } from "../_components/task-actions";
import { Plate, SevDot, vehicleHref } from "../_components/ui";
import { NO_COORDINATOR, kmIntro, type Board, type KmRow, type ListRow } from "./model";
import { LogKmLink, ReminderSettings, WeeklyOnlySwitch } from "./schedule-client";

const pad = "px-5 md:px-8";
const muted = "text-[13px] text-[#55524A]";

/** This week / Next week: a column per inspection day (stacked on a phone), a card per vehicle. */
export function BoardView({ b, canWrite, today, weeklyOnlyList }: { b: Board; canWrite: boolean; today: string; weeklyOnlyList: string[] }) {
  return (
    <section aria-label={b.title}>
      <SectionBar title={b.title} meta={`${fmtDate(b.ws)} – ${fmtDate(b.we)}`} />
      <div className={cn(pad, "space-y-1 py-3")}>
        {canWrite ? (
          <WeeklyOnlySwitch key={`${b.ws}-${b.weeklyOnly}`} ws={b.ws} list={weeklyOnlyList} today={today} on={b.weeklyOnly} />
        ) : (
          b.weeklyOnly && <p className={muted}>Weekly checks only this week.</p>
        )}
      </div>
      <div className="grid grid-cols-1 border-t border-rule sm:grid-cols-2 lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none">
        {b.cols.map((c) => (
          <div key={c.d} className={cn("min-w-0 border-b border-rule sm:border-r", c.today && "bg-bone")}>
            <h3 className={cn(pad, "flex min-h-11 items-center justify-between gap-2 border-b border-rule py-2 lg:px-4")}>
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em]">{fmtDay(c.date)}</span>
              {c.today && <StatusPill tone="warn">Today</StatusPill>}
            </h3>
            {c.cards.length ? (
              <ul className="divide-y divide-rule">
                {c.cards.map((v) => (
                  <li key={v.id} className={cn(pad, "space-y-2 py-3 lg:px-4")}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={vehicleHref(v.id)} className="font-display text-[16px] font-black uppercase leading-tight underline-offset-2 hover:underline">
                        {v.name}
                      </Link>
                      <Plate reg={v.reg} />
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {v.monthly && <StatusPill tone="quiet">Monthly check</StatusPill>}
                      <StatusPill tone={v.tone}>{v.pill}</StatusPill>
                    </div>
                    {canWrite && v.start && <StartButton vehicleId={v.id} type={v.start.type} label={v.start.label} />}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={cn(pad, muted, "py-3 lg:px-4")}>No vehicles</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Services and inspections by km. */
export function KmPanel({ rows, canWrite, today }: { rows: KmRow[]; canWrite: boolean; today: string }) {
  return (
    <section aria-label="Services and inspections by km">
      <SectionBar title="Services and inspections by km" />
      <p className={cn(pad, muted, "py-3")}>{kmIntro()}</p>
      {rows.length ? (
        <ul className="divide-y divide-rule border-t border-rule">
          {rows.map((r) => (
            <li key={r.id} className={cn(pad, "flex gap-3 py-3")}>
              {r.sev === "none" ? <span aria-hidden className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 border border-rule-strong" /> : <SevDot sev={r.sev} />}
              <div className="min-w-0 flex-1 text-[14px] leading-snug">
                <Link href={vehicleHref(r.id)} className="font-medium underline-offset-2 hover:underline">
                  {r.name}
                </Link>{" "}
                · {r.text}
                {r.booked && (
                  <>
                    {" "}
                    <StatusPill tone="quiet">Booked {fmtDay(r.booked)}</StatusPill>
                  </>
                )}
                <span className="mt-0.5 block text-[13px] tabular-nums text-[#55524A]">
                  {r.odo}
                  {r.proj ? " · " + r.proj : ""}
                </span>
              </div>
              {canWrite && (
                <LogKmLink vehicle={{ id: r.id, name: r.name, reg: r.reg, odometer: r.odometer, odometerDate: r.odometerDate }} today={today} />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className={cn(pad, muted, "pb-4")}>No vehicles in service.</p>
      )}
      {canWrite && (
        <p className={cn(pad, "border-t border-rule py-3 text-[13px]")}>
          Missing a starting point? Open the vehicle and use <strong>Edit details</strong> to fill in the odometer reading at the last service and the last
          bumper-to-bumper inspection.
        </p>
      )}
    </section>
  );
}

/** Workshop bookings, or trips and rentals: one line each. */
export function DatedList({ title, rows, empty, action }: { title: string; rows: ListRow[]; empty: string; action?: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <SectionBar title={title} />
      {rows.length ? (
        <ul className="divide-y divide-rule">
          {rows.map((r, i) => (
            <li key={i} className={cn(pad, "flex flex-wrap gap-x-3 gap-y-0.5 py-3 text-[14px]")}>
              <SevDot sev={r.sev} />
              <span className="min-w-0 flex-1">
                <Link href={vehicleHref(r.vehicleId)} className="font-medium underline-offset-2 hover:underline">
                  {r.name}
                </Link>{" "}
                · {r.text}
              </span>
              <span className="w-full pl-[22px] text-[13px] text-[#55524A] sm:w-auto sm:pl-0">{r.when}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={cn(pad, muted, "py-4")}>{empty}</p>
      )}
      {action && <div className={cn(pad, "border-t border-rule py-2")}>{action}</div>}
    </section>
  );
}

/** Vehicle co-ordinator and reminders. The co-ordinator is the Vehicle Coordinator role holder. */
export function CoordinatorPanel({
  coordinator,
  notify,
  canWrite,
}: {
  coordinator: Coordinator | null;
  notify: { email: boolean; slack: boolean };
  canWrite: boolean;
}) {
  const how = [notify.email && "by email", notify.slack && "on Slack"].filter(Boolean) as string[];
  return (
    <section aria-label="Vehicle co-ordinator and reminders" id="coordinator">
      <SectionBar title="Vehicle co-ordinator and reminders" />
      <div className={cn(pad, "space-y-4 py-4")}>
        <p className={muted}>
          The co-ordinator’s name and phone number are printed on every in-car guide. Reminders go out at 7am: two days before, one day before and on the inspection
          day, plus trips, workshop visits, services due by km and booking clashes. Vehicles on a trip or at the workshop are left out until they’re back.
        </p>
        {coordinator ? (
          <dl className="divide-y divide-rule border-y border-rule text-[14px]">
            {(
              [
                ["Vehicle co-ordinator", coordinator.name || "Name not on their Hub profile"],
                ["Phone", coordinator.phone ? <a href={`tel:${coordinator.phone.replace(/\s/g, "")}`} className="underline">{coordinator.phone}</a> : "No phone number on their Hub profile"],
                ["Email", coordinator.email ? <a href={`mailto:${coordinator.email}`} className="break-all underline">{coordinator.email}</a> : "—"],
                ["Slack", coordinator.slackUserId ? "Linked" : "No Slack account on their Hub profile"],
              ] as [string, React.ReactNode][]
            ).map(([k, v]) => (
              <div key={k} className="grid grid-cols-1 gap-0.5 py-2.5 sm:grid-cols-[180px_1fr] sm:gap-4">
                <dt className="mono-label">{k}</dt>
                <dd className="min-w-0">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="border-l-[3px] border-amber-border pl-3 text-[14px]">{NO_COORDINATOR}</p>
        )}
        <p className={muted}>
          The co-ordinator is whoever holds the Vehicle Coordinator role in Users &amp; Roles; the details come from their Hub profile. When the role moves to
          someone else, the reminders follow, and the printed in-car guides show as out of date.
        </p>
        {canWrite ? (
          <ReminderSettings initial={notify} />
        ) : (
          <p className="text-[14px]">Reminders: {how.length ? how.join(" and ") : "off"}</p>
        )}
      </div>
    </section>
  );
}
