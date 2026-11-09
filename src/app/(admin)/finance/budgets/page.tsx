import { BudgetSheet } from "./budget-sheet";
import { loadBudgetSheet } from "./load-sheet";

/**
 * Empty team-budget sheet for FFSA NPC in rand. org_id is copied from the
 * chosen fiscal period. Lines, totals and notes stay in the browser: budget
 * tables are not on this branch, and this page does not write them. Xero
 * actuals are read on /finance/budgets/[id].
 */
export default async function BudgetsPage() {
  const { options, canReadXero } = await loadBudgetSheet();

  return (
    <div className="ffsa-screen">
      <BudgetSheet options={options} canReadXero={canReadXero} />
    </div>
  );
}
