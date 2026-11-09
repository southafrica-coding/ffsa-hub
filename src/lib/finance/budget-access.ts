/**
 * Who may open the budget sheet.
 *
 * This mirrors the budget policies already in the database. It does not
 * grant finance office, and it does not treat a ministry member as a leader.
 * can_edit_all_budgets is is_admin or budget.edit_all. can_view_all_budgets
 * adds finance.view, budget.view_all and budget.approve. A person who is
 * not one of those may open the sheet only when leads_staff_ministry is
 * true for a ministry, or when row level security already returns a budget
 * they belong to. finance_private is not called: PostgREST exposes public.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type BudgetGate = {
  /** is_admin or budget.edit_all. Creates for any owner the caller can read. */
  editAll: boolean;
  /** The view-all policy: edit-all, finance.view, budget.view_all, or budget.approve. */
  viewAll: boolean;
  /** Ministries where leads_staff_ministry is true. Empty when editAll. */
  leadMinistryIds: string[];
  canOpen: boolean;
};

async function allowed(supabase: Client, name: string, args?: Record<string, string>): Promise<boolean> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) return false;
  return data === true;
}

export function canOpenBudgetSheet(gate: {
  viewAll: boolean;
  leadsMinistry: boolean;
  memberOfBudget: boolean;
}): boolean {
  return gate.viewAll || gate.leadsMinistry || gate.memberOfBudget;
}

export async function loadBudgetGate(supabase: Client): Promise<BudgetGate> {
  const [admin, editAllPerm, viewAllPerm, approve, financeView] = await Promise.all([
    allowed(supabase, "is_admin"),
    allowed(supabase, "has_permission", { required_permission: "budget.edit_all" }),
    allowed(supabase, "has_permission", { required_permission: "budget.view_all" }),
    allowed(supabase, "has_permission", { required_permission: "budget.approve" }),
    allowed(supabase, "has_permission", { required_permission: "finance.view" }),
  ]);
  const editAll = admin || editAllPerm;
  const viewAll = editAll || viewAllPerm || approve || financeView;

  let leadMinistryIds: string[] = [];
  if (!viewAll) {
    const { data } = await supabase.from("staff_ministries").select("id").eq("is_active", true);
    const ids = Array.isArray(data) ? data.map((row: { id: string }) => row.id) : [];
    const leads = await Promise.all(
      ids.map(async (id: string) => ({
        id,
        leads: await allowed(supabase, "leads_staff_ministry", { target_ministry_id: id }),
      }))
    );
    leadMinistryIds = leads.filter((row) => row.leads).map((row) => row.id);
  }

  let memberOfBudget = false;
  if (!viewAll && leadMinistryIds.length === 0) {
    const { data, error } = await supabase.from("budgets").select("id").limit(1);
    memberOfBudget = !error && Array.isArray(data) && data.length > 0;
  }

  return {
    editAll,
    viewAll,
    leadMinistryIds,
    canOpen: canOpenBudgetSheet({
      viewAll,
      leadsMinistry: leadMinistryIds.length > 0,
      memberOfBudget,
    }),
  };
}
