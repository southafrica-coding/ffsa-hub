import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { getVehicles, getVehicleAccess, type Vehicle } from "@/services/vehicles";
import { Masthead } from "@/components/ffsa";
import { FleetAdmin } from "./fleet-admin";
import { SlackAlertsCard } from "./slack-alerts-card";

export default async function FleetPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [, access, vehiclesRes] = await Promise.all([
    requireModuleAccess(supabase, user.id, "vehicles"),
    getVehicleAccess(supabase, user.id),
    getVehicles(supabase),
  ]);
  if (!access.canManage) redirect("/bookings/vehicles");

  const vehicles = (vehiclesRes.data ?? []) as Vehicle[];

  return (
    <div className="ffsa-screen">
      <Masthead context="Reservations" title="Manage fleet" />
      <div className="max-w-3xl space-y-5 px-5 py-6 md:px-8 md:py-7">
        <p className="text-[13px] text-[color:var(--text-secondary)]">
          The base vehicles available to book. Set a vehicle to “maintenance” to
          take it out of availability without deleting its history.
        </p>
        <FleetAdmin vehicles={vehicles} />
        <SlackAlertsCard />
      </div>
    </div>
  );
}
