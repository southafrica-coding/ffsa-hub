import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  getVehicleBookings,
  getVehicles,
  getVehicleAccess,
  countPendingVehicleBookings,
  type VehicleBookingWithRefs,
  type Vehicle,
} from "@/services/vehicles";
import { VehiclesBoard } from "../vehicles-view";
import { calendarWindow, WINDOW_DAYS } from "../fleet-calendar";
import { boardFleet } from "../fleet/calendar/board-fleet";

/**
 * The vehicles team's booking board — every request with its status, dates,
 * assigned vehicles, purpose, point person and head count.
 *
 * Deliberately off the landing page: this is the view that answers "who has
 * the Kombi and why", which is the coordinator's business, not everyone's.
 * Regular users get the availability calendar instead.
 */
export default async function VehicleBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; from?: string; month?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [, access] = await Promise.all([
    requireModuleAccess(supabase, user.id, "vehicles"),
    getVehicleAccess(supabase, user.id),
  ]);

  if (!(access.canApprove || access.canManage)) {
    redirect("/bookings/vehicles");
  }

  const status = params.status ?? "all";
  // The fleet calendar always shows every live booking in its 30 days — the
  // status filter only narrows the table underneath. Old ?month= links still work.
  const from = params.from ?? params.month;
  const w = calendarWindow(from);
  const [bookingsRes, vehiclesRes, pendingCount, calendarRes, fleet] = await Promise.all([
    getVehicleBookings(supabase, status !== "all" ? { status } : undefined),
    getVehicles(supabase),
    countPendingVehicleBookings(supabase),
    getVehicleBookings(supabase, { from: w.from, to: w.to }),
    // Fleet's lane and panel (workshop visits, inspection days, clashes): Fleet users only.
    boardFleet(supabase, user.id, w.from, WINDOW_DAYS),
  ]);

  return (
    <VehiclesBoard
      bookings={(bookingsRes.data ?? []) as VehicleBookingWithRefs[]}
      vehicles={(vehiclesRes.data ?? []) as Vehicle[]}
      access={access}
      statusFilter={status}
      pendingCount={pendingCount}
      calendarBookings={(calendarRes.data ?? []) as VehicleBookingWithRefs[]}
      from={from}
      fleetOverlay={fleet?.overlay ?? null}
      fleetPanel={fleet?.panel ?? null}
    />
  );
}
