import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect, notFound } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  getVehicleBookingById,
  getVehicleAccess,
  getInspectionFiles,
  type VehicleBookingWithRefs,
  type VehicleInspectionFile,
} from "@/services/vehicles";
import { InspectionForm } from "../../inspection-form";

export default async function ReturnInspectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [, access] = await Promise.all([
    requireModuleAccess(supabase, user.id, "vehicles"),
    getVehicleAccess(supabase, user.id),
  ]);

  const { data: booking } = await getVehicleBookingById(supabase, id);
  if (!booking) notFound();
  const b = booking as VehicleBookingWithRefs;

  const isManager = access.isAdmin || access.canApprove || access.canManage;
  if (!isManager && b.requested_by !== user.id) redirect(`/bookings/vehicles/${id}`);

  const vehicles = (b.assignments ?? [])
    .map((a) => a.vehicle)
    .filter(Boolean)
    .map((v) => ({ id: v!.id, name: v!.name }));
  const driverNames = (b.drivers ?? []).map((d) => d.name).join(", ") || (b.requester_name ?? "");

  const { data: fileRows } = await getInspectionFiles(supabase, id);
  const admin = createAdminClient();
  const initialFiles = await Promise.all(
    ((fileRows ?? []) as VehicleInspectionFile[]).map(async (f) => {
      const { data: signed } = await admin.storage
        .from("vehicle-inspections")
        .createSignedUrl(f.file_path, 3600);
      return {
        id: f.id,
        kind: f.kind,
        file_name: f.file_name,
        signed_url: signed?.signedUrl ?? null,
      };
    })
  );

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <p className="page-eyebrow">RESERVATIONS</p>
        <h1 className="page-title">Return inspection</h1>
        <p className="mt-1 text-sm text-muted-foreground">{b.booking_name} · Sign In</p>
      </div>
      <InspectionForm
        bookingId={id}
        kind="return"
        vehicles={vehicles}
        defaultDriverNames={driverNames}
        initialFiles={initialFiles}
      />
    </div>
  );
}
