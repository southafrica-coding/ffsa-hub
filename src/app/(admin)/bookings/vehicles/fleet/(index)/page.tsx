import Link from "next/link";
import { getVehicleAccess } from "@/services/vehicles";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Bar, Masthead, SectionBar } from "@/components/ffsa";
import { loadFleet } from "@/lib/fleet/load";
import { fmtMins, plural, timeWeek, todayTasks, weekStartOf, weeklyOnly, type Task } from "@/lib/fleet/rules";
import { getFleetAccess } from "@/services/fleet";
import { FLEET, FLEET_CALENDAR, Plate, SevDot, sevLabel, vehicleHref } from "../_components/ui";
import { DropOffButton, StartButton } from "../_components/task-actions";
import { LogKmButton } from "../vehicles/fleet-client";
import { VisitButton } from "../[vehicleId]/visit-dialog";
import { buildVisitCtx, lastProvider } from "../[vehicleId]/visit-ctx";
import type { Visit } from "../[vehicleId]/model";
import { OutOfActionSection } from "../calendar/sections";
import { outOfAction } from "@/lib/fleet/out-of-action";

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "Tuesday, 17 November" (the app's long date). */
const longDate = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  return `${DOW[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
};

const linkBtn =
  "inline-flex min-h-11 items-center justify-center border border-ink bg-white px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink hover:bg-bone";

// Today: Fleet's landing page (the Fleet app's todayView, SPEC 5.1). Everything to do
// today in the app's order, each with roughly how long and one button; then Coming up
// and Time this week. People who only manage the bookable vehicle list (no Fleet
// access) land on Settings, where "Manage fleet" lives.
export default async function FleetToday() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const [access, vehicleAccess] = await Promise.all([getFleetAccess(supabase, user.id), getVehicleAccess(supabase, user.id)]);
  if (!access.canView) redirect(`${FLEET}/settings`);
  // "Sort it out" opens the booking board, which is the vehicles team's (Jack, #698).
  const canBoard = vehicleAccess.canApprove || vehicleAccess.canManage;

  const { F, providers } = await loadFleet(supabase);
  const canWrite = access.canManage;
  const { tasks, later } = todayTasks(F);
  const total = tasks.reduce((s, t) => s + (t.mins || 0), 0);
  const time = timeWeek(F);
  const out = outOfAction(F);
  const sub = `${longDate(F.today)}${tasks.length ? ` · ${plural(tasks.length, "thing")} to do${total ? ", about " + fmtMins(total) : ""}` : ""}`;

  const action = (t: Task) => {
    const a = t.action;
    if (!a) return null;
    if (a.kind === "calendar")
      return canBoard ? (
        <Link href={FLEET_CALENDAR} className={linkBtn}>
          Sort it out
        </Link>
      ) : null;
    if (!canWrite) return null;
    if (a.kind === "start") return <StartButton vehicleId={t.v.id} type={a.type} />;
    if (a.kind === "dropoff") return <DropOffButton vehicleId={t.v.id} today={F.today} />;
    const ctx = buildVisitCtx(F, providers, t.v.id);
    if (a.kind === "collect") {
      const visit = F.visits.find((r) => r.id === a.recordId) as unknown as Visit | undefined;
      return visit ? (
        <VisitButton ctx={ctx} mode="outcome" visit={visit}>
          Collected
        </VisitButton>
      ) : null;
    }
    // book
    const from = a.from || F.today;
    return (
      <VisitButton ctx={ctx} mode="book" tone="solid" prefill={{ kind: a.visitKind, date: from, until: a.to || from, provider: lastProvider(F, t.v.id, providers) }}>
        Book
      </VisitButton>
    );
  };

  return (
    <>
      <Masthead
        context={sub}
        title="Today"
        actions={
          canWrite ? (
            <>
              <LogKmButton vehicles={F.vehicles.filter((v) => !["For sale", "Off the road"].includes(v.status || "")).map((v) => ({ id: v.id, name: v.name, reg: v.reg, odometer: v.odometer, odometerDate: v.odometerDate }))} today={F.today} />
              <Link href="/bookings/vehicles/new" className={linkBtn}>
                Add trip or rental
              </Link>
            </>
          ) : undefined
        }
      />

      {!F.vehicles.length ? (
        <section className="px-5 py-6 md:px-8">
          <h2 className="font-display text-[22px] font-black uppercase">No vehicles yet</h2>
          <p className="mt-1 text-[14px] text-[#55524A]">
            Add the vehicles under <Link href={`${FLEET}/settings`} className="underline">Settings</Link> first. The <Link href={`${FLEET}/guide`} className="underline">Guide</Link> explains how to set up Fleet.
          </p>
        </section>
      ) : (
        <>
          {/* Fleet 5c: vehicles in for a repair or broken down, and their bookings. */}
          <OutOfActionSection vehicles={out.vehicles} resume={out.resume} canWrite={canWrite} today={F.today} />
          <SectionBar title="To do today" meta={tasks.length ? plural(tasks.length, "task") : undefined} />
          {weeklyOnly(F, weekStartOf(F.today)) && (
            <p className="border-b border-rule px-5 py-2.5 text-[13px] text-[#55524A] md:px-8">
              This week: weekly checks only. The monthly checks move to next week (<Link href={`${FLEET}/schedule`} className="underline">change</Link>).
            </p>
          )}
          {tasks.length ? (
            <ul className="divide-y divide-rule border-b border-ink">
              {tasks.map((t, i) => (
                <li key={i} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center md:px-8">
                  <div className="flex min-w-0 flex-1 gap-3">
                    <SevDot sev={t.sev} />
                    <div className="min-w-0">
                      <span className="sr-only">{sevLabel(t.sev)}: </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={vehicleHref(t.v.id)} className="font-medium underline-offset-2 hover:underline">
                          {t.v.name}
                        </Link>
                        <Plate reg={t.v.reg} />
                      </div>
                      <p className="mt-0.5 text-[14px] leading-snug">
                        <b>{t.title}</b> · {t.sub}
                      </p>
                      {t.mins ? <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[#7C786C]">About {fmtMins(t.mins)}</p> : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 pl-[22px] sm:pl-0">{action(t)}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-3 border-b border-ink px-5 py-4 text-[14px] md:px-8">
              <SevDot sev="ok" className="mt-0" />
              Nothing to do today.
            </p>
          )}

          <div className="grid md:grid-cols-2">
            <section className="border-b border-ink md:border-r">
              <SectionBar title="Coming up" />
              {later.length ? (
                <ul className="divide-y divide-rule">
                  {later.map((x, i) => (
                    <li key={i} className="flex gap-3 px-5 py-3 text-[14px] leading-snug md:px-8">
                      <SevDot sev="info" />
                      <span className="min-w-0">
                        <Link href={vehicleHref(x.v.id)} className="font-medium underline-offset-2 hover:underline">
                          {x.v.name}
                        </Link>{" "}
                        · {x.text}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-4 text-[14px] text-[#55524A] md:px-8">Nothing planned for the next two days.</p>
              )}
            </section>

            <section className="border-b border-ink">
              <SectionBar title="Time this week" />
              <div className="space-y-2 px-5 py-4 md:px-8">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-display text-[28px] font-black tabular-nums">{fmtMins(time.total)}</span>
                  <span className="text-[14px] text-[#55524A]">of {fmtMins(time.budget)}</span>
                  {time.over && <span className="border border-destructive px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-destructive">Over budget</span>}
                </p>
                <div role="img" aria-label={`${fmtMins(time.total)} of ${fmtMins(time.budget)}`}>
                  <Bar pct={time.pct} tone={time.over ? "hsl(var(--destructive))" : time.pct > 80 ? "#B98600" : "#0A0A0A"} />
                </div>
                <p className="text-[13px] text-[#55524A]">
                  Inspections {fmtMins(time.inspections.mins)} ({time.inspections.count}) · Bookings, km readings and admin {fmtMins(time.admin.mins)}
                </p>
                {time.averages.length > 0 && <p className="text-[13px] text-[#55524A]">Average {time.averages.join(" · ")}</p>}
                {time.over && (
                  <p className="text-[13px]">
                    Over the budget: on the <Link href={`${FLEET}/checklist`} className="underline">Checklist</Link> page, move slow-changing points to once a month, or spread the checks over more days.
                  </p>
                )}
                <p className="text-[12px] text-[#7C786C]">Timed automatically while you use Fleet.</p>
              </div>
            </section>
          </div>

          <p className="px-5 py-4 text-[13px] text-[#55524A] md:px-8">
            New here? Start with the <Link href={`${FLEET}/guide?page=tutorial`} className="underline">tutorial</Link>.
          </p>
        </>
      )}
    </>
  );
}
