import { createClient } from "@/lib/supabase/server";
import { requireFleet } from "@/lib/fleet/load";
import { getFleetProviders } from "@/services/fleet";
import { PROVIDER_FIELDS } from "@/lib/fleet/providers";
import { Workshops, type Provider } from "./workshops";

// Workshops (SPEC 5.8): where the vehicles go, with phone numbers. The Fleet app's
// providersView.
export default async function FleetWorkshopsPage() {
  const supabase = await createClient();
  const { access } = await requireFleet(supabase);
  const { data, error } = await getFleetProviders(supabase);
  if (error) throw new Error(error.message);
  // Only the workshop's own fields reach the page.
  const providers = ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const p = { id: String(r.id) } as Provider;
    for (const f of PROVIDER_FIELDS) p[f] = typeof r[f] === "string" ? (r[f] as string) : "";
    return p;
  });
  return <Workshops providers={providers} canManage={access.canManage} />;
}
