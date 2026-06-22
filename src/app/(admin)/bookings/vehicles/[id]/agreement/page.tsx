import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  getVehicleBookingById,
  getVehicleAccess,
  getAgreementsForBooking,
  type VehicleBookingWithRefs,
  type VehicleAgreement,
} from "@/services/vehicles";
import { Card, CardContent } from "@/components/ui/card";
import {
  VEHICLE_POLICY_TITLE,
  VEHICLE_POLICY_VERSION,
  VEHICLE_POLICY_INTRO,
  VEHICLE_POLICY_SECTIONS,
} from "@/lib/vehicles/policy";
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
    <div className="space-y-5 max-w-3xl">
      <Link
        href={`/bookings/vehicles/${id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to booking
      </Link>
      <div>
        <p className="page-eyebrow">RESERVATIONS</p>
        <h1 className="page-title">{VEHICLE_POLICY_TITLE}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {b.booking_name} · Policy version {VEHICLE_POLICY_VERSION}
        </p>
      </div>

      {/* Existing signatures */}
      {agreements.length > 0 && (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <h2 className="text-sm font-semibold">Signed</h2>
            {agreements.map((a) => (
              <p key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4" style={{ color: "hsl(142 52% 60%)" }} />
                <span className="font-medium text-foreground">{a.signer_name}</span>
                <span className="text-muted-foreground">
                  signed {a.signed_at.slice(0, 10)} · policy {a.policy_version}
                </span>
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {/* The policy */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-sm text-muted-foreground">{VEHICLE_POLICY_INTRO}</p>
          {VEHICLE_POLICY_SECTIONS.map((s) => (
            <div key={s.heading} className="space-y-1.5">
              <h3 className="text-sm font-semibold text-foreground">{s.heading}</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {s.points.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>

      <AgreementForm
        bookingId={id}
        defaultSignerName={b.requester_name ?? ""}
        defaultSignerEmail={b.requester_email ?? ""}
      />
    </div>
  );
}
