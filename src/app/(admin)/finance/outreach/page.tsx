export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import {
  getOutreachTeams,
  getAggregateFinancials,
  getRecentMoneyMovements,
  getUnmatchedFeePayments,
} from "@/services/outreach-finance";
import { getPrograms } from "@/services/schools";
import { OutreachDashboardClient } from "./dashboard-client";

export default async function OutreachFinancePage() {
  const supabase = await createClient();
  // Same RLS-bound client as the rest of the page: the ledger shows exactly the
  // movements this viewer is already entitled to see, and each source inside
  // these two calls settles on its own so one blocked table cannot 500 the page.
  const [{ data: teams }, { data: programs }, aggregates, movements, unmatched] =
    await Promise.all([
      getOutreachTeams(supabase),
      getPrograms(supabase),
      getAggregateFinancials(supabase),
      getRecentMoneyMovements(supabase),
      getUnmatchedFeePayments(supabase),
    ]);

  // Rendered without a wrapper: the client component's root carries
  // `.ffsa-screen`, and that class only works on a direct child of .admin-content.
  return (
    <OutreachDashboardClient
      teams={(teams ?? []) as Parameters<typeof OutreachDashboardClient>[0]["teams"]}
      programs={(programs ?? []) as Parameters<typeof OutreachDashboardClient>[0]["programs"]}
      aggregates={aggregates}
      movements={movements}
      unmatched={unmatched}
    />
  );
}
