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
import { VehiclesView } from "./vehicles-view";

export default async function VehiclesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) redirect("/login");

  const [, access] = await Promise.all([
    requireModuleAccess(supabase, user.id, "vehicles"),
    getVehicleAccess(supabase, user.id),
  ]);

  const status = params.status ?? "all";
  const [bookingsRes, vehiclesRes, pendingCount] = await Promise.all([
    getVehicleBookings(supabase, status !== "all" ? { status } : undefined),
    getVehicles(supabase),
    countPendingVehicleBookings(supabase),
  ]);

  const bookings = (bookingsRes.data ?? []) as VehicleBookingWithRefs[];
  const vehicles = (vehiclesRes.data ?? []) as Vehicle[];

  return (
    <VehiclesView
      bookings={bookings}
      vehicles={vehicles}
      access={access}
      statusFilter={status}
      pendingCount={pendingCount}
    />
  );
}
