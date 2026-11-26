import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/fleet/api";
import { loadFleet, requireFleet } from "@/lib/fleet/load";
import {
  SEV_RANK,
  VSTATUS,
  activeTrip,
  cardStatus,
  fmtDate,
  fmtDay,
  fmtKm,
  nextTrip,
  profileOf,
  tripName,
  vehicleAlerts,
  weekly,
  whereList,
} from "@/lib/fleet/rules";
import { getFleetFixes, getFleetInspections, getFleetOdometerReadings } from "@/services/fleet";
import { StatusPill } from "@/components/ffsa";
import { cn } from "@/lib/utils/cn";
import { FLEET, Plate, vehicleHref } from "../_components/ui";
import { DAYS_LONG, extraOf, statusOf } from "../vehicles/model";
import { VehicleThumb } from "../vehicles/parts";
import { InspectButton, IssueListButton, LogKmButton, PhotoChange, StatusSelect } from "./header-client";
import { VehicleOutButtons } from "../_components/task-actions";
import {
  TABS,
  attentionRows,
  bookedVisits,
  condFilterOf,
  conditionView,
  headerMeta,
  historyItems,
  fixFromRow,
  inspectionFromRow,
  issuesText,
  keyDates,
  kmFromRow,
  manualStages,
  photoGroups,
  recentTrips,
  tabOf,
  vehicleDetails,
  watchPointOptions,
  type Visit,
} from "./model";
import { ConditionTab, HistoryTab, ManualTab, OverviewTab, PhotosTab } from "./sections";
import { EditDetailsButton, type EditableVehicle } from "./vehicle-dialog";
import { ReportButton } from "./report-button";
import { vehicleFormOf } from "./vehicle-form";
import { VisitButton, type VisitCtx } from "./visit-dialog";
import { buildVisitCtx } from "./visit-ctx";
import type { WatchPanelProps } from "./watch-panel";

// The vehicle page (SPEC 5.3; the Fleet app's vehicleView): header, actions and the
// Overview / Condition / History / Photos / Manual tabs, picked with ?tab=.
export default async function FleetVehiclePage({
  params,
  searchParams,
}: {
  params: Promise<{ vehicleId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ vehicleId: id }, sp] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const { access } = await requireFleet(supabase);
  if (!isUuid(id)) notFound();
  const { F, vehicleRows, providers } = await loadFleet(supabase);
  const v = F.vehicles.find((x) => x.id === id);
  const back = (
    <Link href={`${FLEET}/vehicles`} className="inline-flex min-h-11 items-center px-5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] md:px-8">
      ← All vehicles
    </Link>
  );
  if (!v)
    return (
      <>
        {back}
        <div className="px-5 pb-8 md:px-8">
          <h1 className="font-display text-[28px] font-black uppercase">Vehicle not found</h1>
          <p className="text-[14px] text-[#55524A]">It may have been removed from the fleet.</p>
        </div>
      </>
    );

  const tab = tabOf(sp.tab);
  const canWrite = access.canManage;
  const today = F.today;
  const x = extraOf(vehicleRows.find((r) => r.id === id));
  const visits = F.visits.filter((r) => r.vehicleId === id) as unknown as Visit[];

  // History and Photos read the inspections; History also reads the km readings.
  const [inspRes, odoRes, fixRes] = await Promise.all([
    tab === "history" || tab === "photos" ? getFleetInspections(supabase, { vehicleId: id }) : null,
    tab === "history" ? getFleetOdometerReadings(supabase, id) : null,
    tab === "history" ? getFleetFixes(supabase, id) : null,
  ]);
  for (const r of [inspRes, odoRes]) if (r?.error) throw new Error(r.error.message);
  const inspections = ((inspRes?.data ?? []) as Record<string, unknown>[]).map((r) => inspectionFromRow(r, F.trips));
  const readings = ((odoRes?.data ?? []) as Record<string, unknown>[]).map(kmFromRow);
  // Fixes (358): until that migration is applied the table isn't there, so show none
  // rather than break the History tab.
  if (fixRes?.error) console.error("[fleet] fixes", fixRes.error.message);
  const fixes = fixRes?.error ? [] : ((fixRes?.data ?? []) as Record<string, unknown>[]).map(fixFromRow);

  const w = weekly(F, v);
  const st = statusOf(F, v);
  const t = activeTrip(F, v);
  const n = nextTrip(F, v);
  const tripLine = t ? `${tripName(t)} until ${fmtDay(t.to)}` : n ? `Next: ${tripName(n)} ${fmtDay(n.from)} – ${fmtDay(n.to)}` : "";
  const li = x.lastInspection;

  const ctx: VisitCtx = buildVisitCtx(F, providers, id);
  const pr = profileOf(v);
  const watch: WatchPanelProps = {
    vehicleId: id,
    watch: v.watch || [],
    rows: attentionRows(F.checklist, v, today, visits),
    options: watchPointOptions(F.checklist),
    weak: pr ? { name: pr.name, list: pr.weak } : null,
    canWrite,
    today,
  };
  const editable: EditableVehicle = {
    ...vehicleFormOf(v, x),
    id,
    name: v.name,
    reg: v.reg || "",
    fuel: v.fuel || "",
    seats: v.seats != null ? String(v.seats) : "",
    lastServiceProvider: v.lastService?.provider || "",
    lastB2BProvider: v.lastB2B?.provider || "",
  };

  return (
    <>
      {back}
      <section className="grid gap-5 border-b border-ink px-5 pb-5 md:grid-cols-[280px_1fr] md:px-8">
        <div className="space-y-2">
          <VehicleThumb photo={x.photo} mono={v.model || v.name} alt={v.name} className="aspect-[16/9] w-full max-w-[360px] md:aspect-[4/3]" />
          {canWrite && (
            <div className="max-w-[360px]">
              <PhotoChange vehicleId={id} hasPhoto={!!x.photo} />
            </div>
          )}
        </div>
        <div className="min-w-0 space-y-4">
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="masthead-title !text-[clamp(30px,8vw,52px)]">{v.name}</h1>
              {v.reg ? <Plate reg={v.reg} className="text-[12px]" /> : <span className="font-mono text-[10px] text-[#7C786C]">Registration not captured</span>}
            </div>
            <p className="mt-1 text-[14px] text-[#55524A]">{headerMeta(v, x)}</p>
          </div>
          {/* Phones: status on its own row (so "Booked for workshop" fits), then two up. */}
          <dl className="grid grid-cols-2 gap-x-4 border-t border-rule lg:grid-cols-4 lg:gap-x-0">
            <Fact k="Status" wide>
              {canWrite ? <StatusSelect vehicleId={id} status={v.status || "In service"} statuses={VSTATUS} today={today} /> : <StatusPill tone={st.tone}>{st.text}</StatusPill>}
              {tripLine && <span className="mt-1 block text-[12px] text-[#55524A]">{tripLine}</span>}
              {canWrite && (
                <span className="mt-2 block">
                  <VehicleOutButtons vehicleId={id} vehicleName={v.name} status={v.status} today={today} />
                </span>
              )}
            </Fact>
            <Fact k="Odometer">
              <span className="font-display text-[22px] font-black tabular-nums">{fmtKm(v.odometer)}</span>
            </Fact>
            <Fact k="Weekly check">
              <span className="text-[14px]">{w.wd ? DAYS_LONG[w.wd - 1] + "s" : "No day set"}</span>
              <span className="block text-[12px] text-[#55524A]">{(w.st === "done" || w.st === "skip" || w.st === "none" ? "" : w.name + ": ") + w.label}</span>
            </Fact>
            <Fact k="Last inspection" wide>
              <span className="text-[14px]">{li && li.date ? fmtDate(li.date) : "None yet"}</span>
            </Fact>
          </dl>
          <div className="flex flex-wrap gap-2">
            {canWrite && (
              <>
                <InspectButton vehicleId={id} />
                <LogKmButton vehicle={{ id, name: v.name, reg: v.reg, odometer: v.odometer, odometerDate: v.odometerDate }} today={today} />
                <VisitButton ctx={ctx} mode="book">
                  Book workshop
                </VisitButton>
                <VisitButton ctx={ctx} mode="log">
                  Log workshop visit
                </VisitButton>
              </>
            )}
            <IssueListButton text={issuesText(F.checklist, v, x.vin, today)} />
            <ReportButton vehicleId={id} vehicleName={v.name} today={today} />
            {canWrite && <EditDetailsButton vehicle={editable} statuses={VSTATUS} today={today} />}
          </div>
        </div>
      </section>

      <nav aria-label="Vehicle" className="flex flex-wrap items-end border-b border-ink px-5 pt-4 md:px-8">
        {TABS.map(([k, l]) => (
          <Link
            key={k}
            href={vehicleHref(id, k)}
            aria-current={tab === k ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center px-3 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] sm:px-4",
              tab === k ? "bg-ink text-white" : "text-[#7C786C] hover:text-ink"
            )}
          >
            {l}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <OverviewTab
          v={v}
          alerts={vehicleAlerts(F, v).sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev])}
          booked={bookedVisits(visits)}
          keyDates={keyDates(v, visits, today)}
          watch={watch}
          trips={recentTrips(F, id)}
          details={vehicleDetails(v, x)}
          notes={x.notes}
          ctx={ctx}
          canWrite={canWrite}
        />
      )}
      {tab === "condition" && <ConditionTab vehicleId={id} view={conditionView(F.checklist, v, condFilterOf(sp.f))} f={condFilterOf(sp.f)} today={today} canWrite={canWrite} />}
      {tab === "history" && <HistoryTab items={historyItems(inspections, visits, readings, fixes)} ctx={ctx} canWrite={canWrite} />}
      {tab === "photos" && <PhotosTab groups={photoGroups(inspections, visits)} />}
      {tab === "manual" && (
        <ManualTab
          name={v.name}
          card={cardStatus(v, F.notify, today)}
          where={whereList(v)}
          watch={watch}
          stages={manualStages(F.checklist, v, today, visits)}
          edit={{ vehicle: editable, statuses: VSTATUS, today }}
          canWrite={canWrite}
        />
      )}
    </>
  );
}

function Fact({ k, wide, children }: { k: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("min-w-0 border-b border-rule py-2.5 lg:border-l lg:px-3 lg:first:border-l-0 lg:first:pl-0", wide && "col-span-2 lg:col-span-1")}>
      <dt className="mono-label mb-1">{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}
