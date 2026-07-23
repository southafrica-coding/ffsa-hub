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

  return (
    <div className="space-y-6">
      <OutreachDashboardClient
        teams={(teams ?? []) as Parameters<typeof OutreachDashboardClient>[0]["teams"]}
        programs={(programs ?? []) as Parameters<typeof OutreachDashboardClient>[0]["programs"]}
        aggregates={aggregates}
      />
    </div>
  );
}
