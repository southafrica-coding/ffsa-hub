import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadFleet, requireFleet } from "@/lib/fleet/load";
import { fmtKm, plural, totalPoints } from "@/lib/fleet/rules";
import { Masthead, MastheadAction, SectionBar, StatusPill } from "@/components/ffsa";
import { cn } from "@/lib/utils/cn";
import { FLEET, Plate, SevDot, sevLabel, vehicleHref } from "../_components/ui";
import { AttentionList, LogKmButton } from "./fleet-client";
import { fleetAttention, vehicleCards, type VehicleCard } from "./model";
import { CondBarView, VehicleThumb } from "./parts";

// Vehicles (SPEC 5.2; the Fleet app's fleetView): Needs attention across the fleet,
// then a row per vehicle.
export default async function FleetVehiclesPage() {
  const supabase = await createClient();
  const { access } = await requireFleet(supabase);
  const { F, vehicleRows } = await loadFleet(supabase);
  const alerts = fleetAttention(F);
  const cards = vehicleCards(F, vehicleRows);
  const canWrite = access.canManage;

  return (
    <>
      <Masthead
        context={`Fleet · ${plural(F.vehicles.length, "vehicle")} · ${totalPoints(F.checklist)}-point checklist`}
        title="Vehicles"
        actions={
          canWrite && (
            <>
              {F.vehicles.length > 0 && (
                <LogKmButton
                  today={F.today}
                  vehicles={F.vehicles.map((v) => ({ id: v.id, name: v.name, reg: v.reg, odometer: v.odometer, odometerDate: v.odometerDate }))}
                />
              )}
              <MastheadAction href={`${FLEET}/settings`}>Add vehicle</MastheadAction>
            </>
          )
        }
      />

      {!F.vehicles.length ? (
        <div className="px-5 py-6 md:px-8">
          <h2 className="font-display text-[22px] font-black uppercase">No vehicles yet</h2>
          <p className="mt-2 max-w-xl text-[14px] text-[#55524A]">
            Add each vehicle once in <Link href={`${FLEET}/settings`} className="underline">Settings</Link>; after that you can record inspections,
            workshop visits and photos against it.
          </p>
        </div>
      ) : (
        <>
          <section aria-labelledby="attn">
            <SectionBar title="Needs attention" meta={plural(alerts.length, "item")} />
            <h2 id="attn" className="sr-only">
              Needs attention
            </h2>
            {alerts.length ? (
              <AttentionList alerts={alerts} />
            ) : (
              <p className="flex gap-3 px-5 py-4 text-[14px] md:px-8">
                <SevDot sev="ok" />
                Nothing is due or flagged. Every vehicle has a recent monthly check.
              </p>
            )}
          </section>

          <section aria-label="Vehicles">
            <SectionBar title="The fleet" meta="Changes show up live for everyone using this page" />
            <ul className="divide-y divide-rule border-b border-rule">
              {cards.map((c) => (
                <li key={c.id}>
                  <VehicleRow c={c} />
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}

const SEV_EDGE: Record<string, string> = { crit: "border-l-destructive", warn: "border-l-amber-border", ok: "border-l-transparent" };

function VehicleRow({ c }: { c: VehicleCard }) {
  return (
    <Link href={vehicleHref(c.id)} className={cn("flex gap-3 border-l-[3px] px-5 py-4 hover:bg-bone md:gap-5 md:px-8", SEV_EDGE[c.sev])}>
      <VehicleThumb photo={c.photo} mono={c.mono} className="h-[72px] w-[72px] shrink-0 md:h-[90px] md:w-[120px]" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="font-display text-[18px] font-black uppercase leading-tight">{c.name}</h3>
          {c.reg ? <Plate reg={c.reg} /> : <span className="font-mono text-[10px] text-[#7C786C]">Registration not captured</span>}
        </div>
        <p className="text-[13px] text-[#55524A]">
          {c.meta}
          {c.odometer !== null && (
            <>
              {" · "}
              <span className="tabular-nums">{fmtKm(c.odometer)}</span>
            </>
          )}
        </p>
        <CondBarView bar={c.cond} className="max-w-md" />
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
          <StatusPill tone={c.status.tone}>{c.status.text}</StatusPill>
          <span>{c.week}</span>
        </p>
        <p className="text-[13px] text-[#55524A]">{c.last}</p>
        {c.top && (
          <p className="flex gap-2 text-[13px] leading-snug">
            <SevDot sev={c.top.sev} />
            <span className="min-w-0">
              <span className="sr-only">{sevLabel(c.top.sev)}: </span>
              {c.top.text}
            </span>
          </p>
        )}
      </div>
    </Link>
  );
}
