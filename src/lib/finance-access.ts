import { canManageFinance } from "@/lib/api-auth";
import { hasModuleAccess } from "@/lib/require-permission";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type FinanceHubAccess = {
  /** finance.view (RLS-aware has_permission) or a finance-manage role/grant: every module + Xero. */
  fullFinance: boolean;
  /** The Finance Office role (migration 248) without full finance: donor statements too. */
  financeOffice: boolean;
};

/**
 * Who sees what on the /finance hub. Anyone can run an outreach budget, so
 * Outreach Finance is open to all; this decides the rest.
 *
 * The three checks are independent reads, so they run together — the page
 * used to wait on each in turn. The answer is the same: full finance wins,
 * and Finance Office only counts for someone without it.
 */
export async function getFinanceHubAccess(
  supabase: Client,
  userId: string
): Promise<FinanceHubAccess> {
  const [{ data: canView }, canManage, hasFinanceModule] = await Promise.all([
    supabase.rpc("has_permission", { required_permission: "finance.view" }),
    canManageFinance(supabase, userId),
    hasModuleAccess(supabase, userId, "finance"),
  ]);
  const fullFinance = canView === true || canManage;
  return { fullFinance, financeOffice: !fullFinance && hasFinanceModule };
}
