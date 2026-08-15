export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import {
  getOutreachTeams,
  getAggregateFinancials,
} from "@/services/outreach-finance";
import { getPrograms } from "@/services/schools";
import { OutreachDashboardClient } from "./dashboard-client";

export default async function OutreachFinancePage() {
  const supabase = await createClient();
  const [{ data: teams }, { data: programs }, aggregates] = await Promise.all([
    getOutreachTeams(supabase),
    getPrograms(supabase),
    getAggregateFinancials(supabase),
  ]);

  // Rendered without a wrapper: the client component's root carries
  // `.ffsa-screen`, and that class only works on a direct child of .admin-content.
  return (
    <OutreachDashboardClient
      teams={(teams ?? []) as Parameters<typeof OutreachDashboardClient>[0]["teams"]}
      programs={(programs ?? []) as Parameters<typeof OutreachDashboardClient>[0]["programs"]}
      aggregates={aggregates}
    />
  );
}
