import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadBudgetGate } from "@/lib/finance/budget-access";
import { loadBudgetScopeOptions, type BudgetScopeOptions } from "@/lib/finance/budget-scope";
import { canReadFinanceXero } from "@/lib/finance/orgs";

export async function loadBudgetSheet(): Promise<{ options: BudgetScopeOptions; canReadXero: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const gate = await loadBudgetGate(supabase);
  if (!gate.canOpen) redirect("/finance");

  const [options, canReadXero] = await Promise.all([
    loadBudgetScopeOptions(supabase, gate),
    canReadFinanceXero(supabase, user.id),
  ]);
  return { options, canReadXero };
}
