export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFinanceStaff } from "@/lib/slack/assistant/outreach";
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Open to everyone: RLS hands finance staff every team and everyone else
  // only the outreaches they own or co-lead. School-fee payments are staff
  // business, so only staff read them.
  const staff = user ? await isFinanceStaff(createAdminClient(), user.id) : false;
  // Same RLS-bound client as the rest of the page: the ledger shows exactly the
  // movements this viewer is already entitled to see, and each source inside
  // these two calls settles on its own so one blocked table cannot 500 the page.
  const [{ data: teams }, { data: programs }, aggregates, movements, unmatched] =
    await Promise.all([
      getOutreachTeams(supabase),
      getPrograms(supabase),
      getAggregateFinancials(supabase),
      getRecentMoneyMovements(supabase),
      staff ? getUnmatchedFeePayments(supabase) : Promise.resolve({ count: 0, rows: [] }),
    ]);

  // Rendered without a wrapper: the client component's root is this
  // screen's root.
  return (
    <OutreachDashboardClient
      teams={(teams ?? []) as Parameters<typeof OutreachDashboardClient>[0]["teams"]}
      programs={(programs ?? []) as Parameters<typeof OutreachDashboardClient>[0]["programs"]}
      aggregates={aggregates}
      movements={movements}
      unmatched={unmatched}
      isStaff={staff}
    />
  );
}
