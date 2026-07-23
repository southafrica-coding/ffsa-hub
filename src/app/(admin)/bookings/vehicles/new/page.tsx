import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { getVehicles, getVehicleAccess, type Vehicle } from "@/services/vehicles";
import { VehicleBookingForm } from "../vehicle-booking-form";

export default async function NewVehicleBookingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [, access, vehiclesRes, profileRes] = await Promise.all([
    requireModuleAccess(supabase, user.id, "vehicles"),
    getVehicleAccess(supabase, user.id),
    getVehicles(supabase, { activeOnly: true }),
    supabase.from("users").select("first_name,last_name").eq("id", user.id).single(),
  ]);

  if (!(access.canRequest || access.canApprove || access.canManage)) {
    redirect("/bookings/vehicles");
  }

  const vehicles = (vehiclesRes.data ?? []) as Vehicle[];
  const p = profileRes.data;
  const defaultName = p ? [p.first_name, p.last_name].filter(Boolean).join(" ") : "";

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <p className="page-eyebrow">RESERVATIONS</p>
        <h1 className="page-title">New vehicle request</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Submitting a request does not guarantee a vehicle — it goes to the Vehicle
          Coordinator for approval.
        </p>
      </div>
      <VehicleBookingForm
        vehicles={vehicles}
        defaultRequesterName={defaultName}
        defaultRequesterEmail={user.email ?? ""}
      />
    </div>
  );
}
