/**
 * Archiving and deleting outreach teams (migration 272).
 *
 * Who may archive, unarchive or delete a team is decided in the database by
 * public.is_outreach_staff_editor() (migration 260): Super Admin, General
 * Admin, the finance_admin role, or a finance.edit grant — the same people
 * who already edit every team. The app asks that function rather than
 * re-deriving the rule, so UI, API and RLS can't drift apart. Creating a team
 * stays open to anyone signed in (migration 260).
 *
 * A team may only be deleted when nothing would be lost: every linked table
 * cascades on delete, so a team with money records or people on it is
 * archived instead. The database refuses the delete too (delete_outreach_team).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

/** True when the signed-in caller is an outreach administrator. */
export async function canManageOutreachTeams(supabase: Client): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_outreach_staff_editor");
  return !error && data === true;
}

/** { linked_table: row_count } from outreach_team_delete_blockers(); {} = safe. */
export type DeleteBlockers = Record<string, number>;

/** Singular / plural wording for each thing that would be lost. */
const BLOCKER_LABELS: Record<string, [string, string]> = {
  people: ["person on the team besides the owner", "people on the team besides the owner"],
  outreach_team_budgets: ["category budget", "category budgets"],
  outreach_budget_lines: ["budget line", "budget lines"],
  outreach_budget_imports: ["budget import", "budget imports"],
  outreach_day_plans: ["day plan", "day plans"],
  outreach_fund_releases: ["fund release", "fund releases"],
  outreach_cash_batches: ["cash pull", "cash pulls"],
  outreach_cash_allocations: ["cash allocation", "cash allocations"],
  outreach_expenses: ["expense", "expenses"],
  outreach_expense_imports: ["expense import", "expense imports"],
  outreach_closeouts: ["closeout", "closeouts"],
  outreach_receipt_drafts: ["Slack receipt draft", "Slack receipt drafts"],
};

/** A team is safe to delete only when the blocker check ran and found nothing. */
export function isSafeToDelete(blockers: DeleteBlockers | null | undefined): boolean {
  if (!blockers) return false;
  return Object.values(blockers).every((n) => !n);
}

/** "12 expenses", "1 fund release" … in a stable order, for the "archive instead" message. */
export function describeDeleteBlockers(blockers: DeleteBlockers | null | undefined): string[] {
  if (!blockers) return [];
  const known = Object.keys(BLOCKER_LABELS);
  const keys = Object.keys(blockers)
    .filter((k) => blockers[k] > 0)
    .sort((a, b) => {
      const ia = known.indexOf(a);
      const ib = known.indexOf(b);
      return (ia < 0 ? known.length : ia) - (ib < 0 ? known.length : ib) || a.localeCompare(b);
    });
  return keys.map((k) => {
    const n = blockers[k];
    const fallback = k.replace(/^outreach_/, "").replace(/_/g, " ");
    const [one, many] = BLOCKER_LABELS[k] ?? [fallback, fallback];
    return `${n} ${n === 1 ? one : many}`;
  });
}

/** Columns a create request may set. Anything else in the body is ignored. */
export const CREATE_TEAM_FIELDS = [
  "program_id",
  "team_name",
  "location",
  "country",
  "start_date",
  "end_date",
  "people_count",
  "total_budget_zar",
  "currency",
  "notes",
  "drive_folder_url",
] as const;

/** Columns only the archive / unarchive RPC may change. */
export const ARCHIVE_FIELDS = ["archived_at", "archived_by"] as const;
