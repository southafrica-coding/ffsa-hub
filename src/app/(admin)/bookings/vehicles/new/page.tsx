import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { getVehicles, getVehicleAccess, type Vehicle } from "@/services/vehicles";
import { Masthead } from "@/components/ffsa";
import { VehicleBookingForm } from "../vehicle-booking-form";

export default async function NewVehicleBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
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
    <div className="ffsa-screen">
      <Masthead context="Reservations" title="New vehicle request" />
      <div className="max-w-3xl space-y-5 px-5 py-6 md:px-8 md:py-7">
        <p className="text-[13px] text-[color:var(--text-secondary)]">
          Submitting a request does not guarantee a vehicle — it goes to the Vehicle
          Coordinator for approval.
        </p>
        <VehicleBookingForm
          vehicles={vehicles}
          defaultRequesterName={defaultName}
          defaultRequesterEmail={user.email ?? ""}
          defaultCheckoutDate={
            /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "") ? params.date! : ""
          }
        />
      </div>
    </div>
  );
}
