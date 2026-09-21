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
  searchParams: Promise<{ status?: string }>;
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
  const [bookingsRes, vehiclesRes, pendingCount] = await Promise.all([
    getVehicleBookings(supabase, status !== "all" ? { status } : undefined),
    getVehicles(supabase),
    countPendingVehicleBookings(supabase),
  ]);

  return (
    <VehiclesBoard
      bookings={(bookingsRes.data ?? []) as VehicleBookingWithRefs[]}
      vehicles={(vehiclesRes.data ?? []) as Vehicle[]}
      access={access}
      statusFilter={status}
      pendingCount={pendingCount}
    />
  );
}
