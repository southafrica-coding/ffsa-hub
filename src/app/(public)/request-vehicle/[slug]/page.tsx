import { createAdminClient } from "@/lib/supabase/admin";
import { getVehicles, type Vehicle } from "@/services/vehicles";
import { PublicFormNotice } from "@/components/public-form-shell";
import { PublicVehicleRequestForm } from "./public-vehicle-request-form";

export const dynamic = "force-dynamic";

// Public, no-login vehicle request page. The slug is the secret segment; the
// link can be paused from Fleet settings without changing the slug. Anonymous
// visitors can't pass the settings/fleet RLS, so this reads through the
// service-role admin client — gated by the slug + the `enabled` toggle.
export default async function PublicVehicleRequestPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: link } = await (supabase as any)
    .from("vehicle_request_link_settings")
    .select("slug, enabled, intro_note")
    .eq("slug", slug)
    .maybeSingle();

  if (!link || !link.enabled) {
    return (
      <PublicFormNotice
        eyebrow="Vehicle Requests"
        heading="This link isn't available"
        body="This vehicle-request link may have been turned off or the address is incorrect. Please check with the person who shared it for an up-to-date link."
      />
    );
  }

  const { data: vehiclesData } = await getVehicles(supabase, { activeOnly: true });
  const vehicles = (vehiclesData ?? []) as Vehicle[];

  return (
    <PublicVehicleRequestForm
      slug={slug}
      vehicles={vehicles}
      introNote={link.intro_note ?? null}
    />
  );
}
