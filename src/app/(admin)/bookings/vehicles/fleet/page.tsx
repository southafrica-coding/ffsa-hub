import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireModuleAccess } from "@/lib/require-permission";
import { getVehicles, getVehicleAccess, type Vehicle } from "@/services/vehicles";
import { FleetAdmin } from "./fleet-admin";
import { RequestLinkCard } from "./request-link-card";

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
    <div className="space-y-5 max-w-3xl">
      <Link
        href="/bookings/vehicles"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to bookings
      </Link>
      <div>
        <p className="page-eyebrow">RESERVATIONS</p>
        <h1 className="page-title">Manage fleet</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The base vehicles available to book. Set a vehicle to “maintenance” to
          take it out of availability without deleting its history.
        </p>
      </div>
      <FleetAdmin vehicles={vehicles} />
      <RequestLinkCard />
    </div>
  );
}
