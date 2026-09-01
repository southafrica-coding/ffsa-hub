import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect, notFound } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  getVehicleBookingById,
  getVehicleAccess,
  getInspectionFiles,
  purposeLabel,
  type VehicleBookingWithRefs,
  type VehicleInspectionFile,
} from "@/services/vehicles";
import { Masthead } from "@/components/ffsa";
import { InspectionForm } from "../../inspection-form";

export default async function CollectInspectionPage({
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
    .map((v) => ({
      id: v!.id,
      // The Google form asked for make and plate as two questions; one
      // labelled option answers both and can't disagree with itself.
      name: v!.registration_plate ? `${v!.name} — ${v!.registration_plate}` : v!.name,
    }));
  const driverNames = (b.drivers ?? []).map((d) => d.name).join(", ") || (b.requester_name ?? "");

  // "What are you using it for?" — the booking already answered this.
  const usagePurpose = b.purpose === "other" && b.purpose_note
    ? b.purpose_note
    : purposeLabel(b.purpose);

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
    <div className="ffsa-screen">
      <Masthead context="Reservations" title="Collection inspection" />
      <div className="max-w-3xl space-y-5 px-8 py-7">
        <p className="text-[13px] text-[color:var(--text-secondary)]">{b.booking_name} · Sign Out</p>
        <InspectionForm
          bookingId={id}
          kind="collection"
          vehicles={vehicles}
          defaultDriverNames={driverNames}
          defaultUsagePurpose={usagePurpose}
          defaultCheckinDate={b.return_date}
          initialFiles={initialFiles}
        />
      </div>
    </div>
  );
}
