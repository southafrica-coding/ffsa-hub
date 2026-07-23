import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  getVehicleAccess,
  getPendingVehicleBookings,
  type VehicleBookingWithRefs,
} from "@/services/vehicles";
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
    <div className="space-y-5">
      <div>
        <p className="page-eyebrow">RESERVATIONS</p>
        <h1 className="page-title">Pending requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {pending.length} request{pending.length === 1 ? "" : "s"} awaiting review
        </p>
      </div>
      <RequestsQueue requests={pending} />
    </div>
  );
}
