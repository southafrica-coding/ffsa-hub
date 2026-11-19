import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Masthead } from "@/components/ffsa";
import { loadFleet, requireFleet } from "@/lib/fleet/load";
import { INSP_TYPES, type InspType } from "@/lib/fleet/inspection";
import {
  addDays,
  attentionByItem,
  attentionFor,
  fmtRange,
  profileOf,
  todayInSA,
  weekly,
  whereList,
} from "@/lib/fleet/rules";
import { getMyProfileRow } from "@/services/me";
import { FLEET } from "../../_components/ui";
import { InspectForm, type TripOption } from "./inspect-form";

// The "On <vehicle>" box at Get ready shows only these lines of "Where things are".
const READY_KEYS = ["Fuel", "Starting", "Bonnet", "Battery", "Spare wheel", "Spare wheel, jack and tools", "Jack and wheel spanner", "Tyre pressures"];

// /bookings/vehicles/fleet/[vehicleId]/inspect — a new or continued inspection.
// ?type=pre|post|weekly|monthly|workshop picks the check for a new draft (default: this
// week's routine check); ?new=1 discards any draft first. An existing draft is continued.
export default async function InspectPage({
  params,
  searchParams,
}: {
  params: Promise<{ vehicleId: string }>;
  searchParams: Promise<{ type?: string; new?: string }>;
}) {
  const supabase = await createClient();
  const { user } = await requireFleet(supabase, { manage: true });
  const [{ vehicleId }, sp] = await Promise.all([params, searchParams]);
  const today = todayInSA();
  const [{ F, providers }, me] = await Promise.all([loadFleet(supabase, today), getMyProfileRow(supabase, user.id)]);

  const v = F.vehicles.find((x) => x.id === vehicleId);
  if (!v) {
    return (
      <>
        <Masthead context="Fleet" title="Vehicle not found" />
        <p className="px-5 py-6 text-[14px] md:px-8">
          <Link href={`${FLEET}/vehicles`} className="underline">
            All vehicles
          </Link>
        </p>
      </>
    );
  }

  const p = me.data as { first_name?: string | null; last_name?: string | null; preferred_name?: string | null } | null;
  const inspectorName = p ? [p.preferred_name || p.first_name, p.last_name].filter(Boolean).join(" ") : "";
  const defaultType: InspType = (INSP_TYPES as string[]).includes(sp.type || "") ? (sp.type as InspType) : weekly(F, v).type;

  const attention = attentionFor(F.checklist, v, today, F.visits);
  const pr = profileOf(v);
  const ready = pr ? whereList(v).filter(([k]) => READY_KEYS.includes(k)) : [];

  // Post-trip checks link to the Hub booking they follow (the app's free-text "trip").
  const seen = new Set<string>();
  const recent = F.trips
    .filter((tr) => tr.vehicleId === v.id && tr.from <= today)
    .sort((a, b) => b.to.localeCompare(a.to))
    .filter((tr) => {
      const id = tr.id.split(":")[0];
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, 8);
  const trips: TripOption[] = recent.map((tr) => ({ id: tr.id.split(":")[0], label: `${tr.label || "Trip"}, ${fmtRange(tr.from, tr.to)}` }));
  const back = recent.find((tr) => tr.to <= today && tr.to >= addDays(today, -7));
  const defaultBookingId = back ? back.id.split(":")[0] : "";

  return (
    <InspectForm
      vehicle={v}
      checklist={F.checklist}
      today={today}
      defaultType={defaultType}
      inspectorName={inspectorName}
      startFresh={sp.new === "1"}
      attention={attention}
      attnByItem={attentionByItem(F.checklist, v, today, F.visits)}
      ready={ready}
      modelNotes={(pr && pr.item) || {}}
      providers={providers.map((x) => String(x.name || "")).filter(Boolean)}
      trips={trips}
      defaultBookingId={defaultBookingId}
    />
  );
}
