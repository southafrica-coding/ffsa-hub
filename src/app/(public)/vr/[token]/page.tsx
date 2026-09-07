import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveVehicleRequestLink,
  getVehicles,
  type Vehicle,
} from "@/services/vehicles";
import { PublicFormNotice, PublicFormShell } from "@/components/public-form-shell";
import { PublicVehicleRequestForm } from "./public-request-form";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

// Never let a request link be indexed or previewed with real content: the
// token IS the credential, so a crawler that finds one shouldn't hand it on.
export const metadata: Metadata = {
  title: "Request a vehicle · FFSA",
  robots: { index: false, follow: false },
};

export default async function PublicVehicleRequestPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const admin = createAdminClient();
  const link = await resolveVehicleRequestLink(admin, token);

  if (!link) {
    return (
      <PublicFormNotice
        eyebrow="VEHICLES"
        heading="This link isn't active"
        body="This vehicle request link has been retired or is incorrect. Ask your FFSA contact to send you a current one."
      />
    );
  }

  // Names and types only — the public form shows what's on the fleet, not
  // where anything is or what it costs.
  const { data } = await getVehicles(admin, { activeOnly: true });
  const vehicles = ((data ?? []) as Vehicle[]).map((v) => ({
    id: v.id,
    name: v.name,
    vehicle_type: v.vehicle_type,
    color: v.color,
  }));

  return (
    <PublicFormShell
      eyebrow="VEHICLES"
      heading="Request a vehicle"
      subheading="Tell us when you need it and who'll be driving. A coordinator confirms the vehicle and comes back to you by email."
      maxWidth={640}
    >
      <PublicVehicleRequestForm token={token} vehicles={vehicles} />
    </PublicFormShell>
  );
}
