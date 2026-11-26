// What the workshop visit form needs for one vehicle (server side): its trips for the
// clash hint, the workshops, and the first free 48 hours (one that ignores each booked
// visit, for "Move the workshop visit to …").

import { suggestGap, tripsOf, type FleetData } from "@/lib/fleet/rules";
import { bookedVisits, type Visit } from "./model";
import type { VisitCtx } from "./visit-dialog";

export function buildVisitCtx(F: FleetData, providers: Record<string, unknown>[], vehicleId: string): VisitCtx {
  const v = F.vehicles.find((x) => x.id === vehicleId);
  const visits = F.visits.filter((r) => r.vehicleId === vehicleId) as unknown as Visit[];
  return {
    vehicle: { id: vehicleId, name: v?.name || "", odometer: v?.odometer ?? null },
    providers: providers.map((p) => String(p.name)),
    trips: tripsOf(F, vehicleId).map((tr) => ({ id: tr.id, from: tr.from, to: tr.to, label: tr.label })),
    // Only a booked visit blocks days, so only a booked one needs a gap that ignores itself.
    gaps: Object.fromEntries([["new", suggestGap(F, vehicleId)], ...bookedVisits(visits).map((r) => [r.id, suggestGap(F, vehicleId, { ignore: r.id })])]),
    today: F.today,
  };
}

/** The workshop the app suggests for a new booking: the last one used, else the first listed. */
export function lastProvider(F: FleetData, vehicleId: string, providers: Record<string, unknown>[]): string {
  const v = F.vehicles.find((x) => x.id === vehicleId);
  return (v?.lastService?.provider || v?.lastB2B?.provider || v?.followUp?.provider || (providers[0] && String(providers[0].name)) || "") as string;
}
