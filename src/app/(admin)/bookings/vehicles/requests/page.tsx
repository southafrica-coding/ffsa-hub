import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  getVehicleAccess,
  getPendingVehicleBookings,
  type VehicleBookingWithRefs,
} from "@/services/vehicles";
import { Masthead } from "@/components/ffsa";
import { RequestsQueue } from "./requests-queue";

export default async function VehicleRequestsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [, access] = await Promise.all([
    requireModuleAccess(supabase, user.id, "vehicles"),
    getVehicleAccess(supabase, user.id),
  ]);
  if (!access.canApprove && !access.canManage) redirect("/bookings/vehicles");

  const { data } = await getPendingVehicleBookings(supabase);
  const pending = (data ?? []) as VehicleBookingWithRefs[];

  return (
    // No NeedsYou band here: the whole page IS the review queue, so a yellow
    // strip pointing at it would be pointing at itself.
    <div className="ffsa-screen">
      <Masthead context="Reservations" title="Pending requests" />
      <div className="px-5 py-6 md:px-8 md:py-7">
        <RequestsQueue requests={pending} />
      </div>
    </div>
  );
}
