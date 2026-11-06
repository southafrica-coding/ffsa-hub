import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  getVehicleBookingById,
  getVehicleAccess,
  getAgreementsForBooking,
  type VehicleBookingWithRefs,
  type VehicleAgreement,
} from "@/services/vehicles";
import {
  VEHICLE_POLICY_TITLE,
  VEHICLE_POLICY_VERSION,
  VEHICLE_POLICY_INTRO,
  VEHICLE_POLICY_SECTIONS,
} from "@/lib/vehicles/policy";
import { Masthead, SectionBar } from "@/components/ffsa";
import { AgreementForm } from "../../agreement-form";

export default async function AgreementPage({
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

  const { data: agreementRows } = await getAgreementsForBooking(supabase, id);
  const agreements = (agreementRows ?? []) as VehicleAgreement[];

  return (
    <div className="ffsa-screen">
      <Masthead context="Reservations" title={VEHICLE_POLICY_TITLE} />
      <div className="max-w-3xl space-y-5 px-5 py-6 md:px-8 md:py-7">
        <p className="text-[13px] text-[color:var(--text-secondary)]">
          {b.booking_name} · Policy version {VEHICLE_POLICY_VERSION}
        </p>

        {/* Existing signatures */}
        {agreements.length > 0 && (
          <div className="border border-ink bg-white">
            <SectionBar title="Signed" meta={`${agreements.length}`} />
            <div className="space-y-2 p-6">
              {agreements.map((a) => (
                <p key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-grass-text" />
                  <span className="font-medium">{a.signer_name}</span>
                  <span className="text-[color:var(--text-secondary)]">
                    signed {a.signed_at.slice(0, 10)} · policy {a.policy_version}
                  </span>
                </p>
              ))}
            </div>
          </div>
        )}

        {/* The policy */}
        <div className="border border-ink bg-white">
          <SectionBar title="The policy" />
          <div className="space-y-4 p-6">
            <p className="text-sm text-[color:var(--text-secondary)]">{VEHICLE_POLICY_INTRO}</p>
            {VEHICLE_POLICY_SECTIONS.map((s) => (
              <div key={s.heading} className="space-y-1.5">
                <h3 className="text-[15px]">{s.heading}</h3>
                <ul className="list-disc space-y-1 pl-5 text-sm text-[color:var(--text-secondary)]">
                  {s.points.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <AgreementForm
          bookingId={id}
          defaultSignerName={b.requester_name ?? ""}
          defaultSignerEmail={b.requester_email ?? ""}
        />
      </div>
    </div>
  );
}
