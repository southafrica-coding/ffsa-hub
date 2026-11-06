import { BudgetSheet } from "../budget-sheet";
import { loadBudgetSheet } from "../load-sheet";

const BUDGET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Same empty sheet, plus a read of GET /api/finance/budgets/[id]/actuals.
 * The budget row itself is not loaded here — those tables are not on this
 * branch. A bad id simply doesn't ask Xero.
 */
export default async function BudgetActualsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { options, canReadXero } = await loadBudgetSheet();
  const budgetId = BUDGET_ID.test(id) ? id : null;

  return (
    <div className="ffsa-screen">
      <BudgetSheet
        options={options}
        canReadXero={canReadXero}
        budgetId={budgetId}
        invalidBudgetId={!budgetId}
      />
    </div>
  );
}
