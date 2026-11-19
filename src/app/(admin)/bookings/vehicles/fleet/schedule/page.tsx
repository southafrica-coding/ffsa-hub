import Link from "next/link";
import { FLEET } from "../_components/ui";
import { createClient } from "@/lib/supabase/server";
import { loadFleet, requireFleet } from "@/lib/fleet/load";
import { Masthead, SectionBar } from "@/components/ffsa";
import {
  boards,
  budgetLine,
  kmRows,
  notifyState,
  otherWeeklyOnly,
  scheduleForm,
  scheduleSub,
  tripRows,
  workshopRows,
} from "./model";
import { BoardView, CoordinatorPanel, DatedList, KmPanel } from "./sections";
import { ScheduleSettings, WeeklyOnlyWeeks } from "./schedule-client";

// Schedule (SPEC 5.7; the Fleet app's scheduleView): this week and next week by
// inspection day, services and inspections by km, workshop bookings, trips and rentals,
// then the schedule settings and the co-ordinator (the Vehicle Coordinator role holder).
export default async function FleetSchedulePage() {
  const supabase = await createClient();
  const { access } = await requireFleet(supabase);
  const { F, coordinator } = await loadFleet(supabase);
  const canWrite = access.canManage;
  const weeklyOnlyList = F.schedule?.weeklyOnly || [];
  const form = scheduleForm(F);
  const { saved, ...initial } = form;
  const stored = Object.fromEntries(
    F.vehicles.map((v) => [v.id, Number((v as { inspectionDay?: number | null }).inspectionDay) || null])
  );
  const budget = budgetLine(F);

  return (
    <>
      <Masthead context="Fleet · Inspection schedule" title="Schedule" />
      <div className="space-y-3 border-b border-rule px-5 py-4 md:px-8">
        <p className="text-[14px]">{scheduleSub(F)}</p>
        <p className="border-l-[3px] border-ink pl-3 text-[13px] text-[#55524A]">
          Weekly checks are postponed while a vehicle is away on a trip or rental, or at the workshop, and show as due once it’s back. Trips and rentals are
          the Hub’s vehicle bookings: they appear here by themselves.
        </p>
      </div>

      {boards(F).map((b) => (
        <BoardView key={b.ws} b={b} canWrite={canWrite} today={F.today} weeklyOnlyList={weeklyOnlyList} />
      ))}

      <KmPanel rows={kmRows(F)} canWrite={canWrite} today={F.today} />

      <DatedList title="Workshop bookings" rows={workshopRows(F)} empty="No workshop visits booked." />

      <DatedList
        title="Trips and rentals"
        rows={tripRows(F)}
        empty="None booked."
        action={
          canWrite && (
            <Link
              href="/bookings/vehicles/new"
              className="inline-flex min-h-11 items-center justify-center border border-ink bg-white px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink hover:bg-bone"
            >
              Add trip or rental
            </Link>
          )
        }
      />

      {canWrite && (
        <>
          <section aria-label="Inspection days">
            <SectionBar title="Inspection days" meta={budget.text} />
            {budget.over && <p className="border-b border-rule px-5 py-3 text-[13px] md:px-8">{budget.over}</p>}
            <ScheduleSettings
              initial={initial}
              stored={stored}
              saved={saved}
              vehicles={F.vehicles.map((v) => ({ id: v.id, name: v.name, reg: v.reg || null }))}
            />
          </section>
          <section aria-label="Weekly checks only">
            <SectionBar title="Weekly checks only" />
            <div className="space-y-3 px-5 py-4 md:px-8">
              <p className="text-[13px] text-[#55524A]">
                Short on time? Make a week weekly checks only: the monthly checks then move to the next week. This week and next week have their own switch
                above.
              </p>
              <WeeklyOnlyWeeks weeks={otherWeeklyOnly(F)} list={weeklyOnlyList} today={F.today} />
            </div>
          </section>
        </>
      )}

      <CoordinatorPanel coordinator={coordinator} notify={notifyState(F)} canWrite={canWrite} />
      {access.isAdmin && (
        <p className="px-5 pb-6 text-[13px] text-[#55524A] md:px-8">
          <Link href={`${FLEET}/reminder`} className="underline">
            Preview the 07:00 reminder
          </Link>{" "}
          for any date, without sending it.
        </p>
      )}
    </>
  );
}
