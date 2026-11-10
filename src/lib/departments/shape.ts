// Response serializers. Budget links are isolated here so the shape can
// switch without touching queries. Currency is always ZAR.

import type { DepartmentBudgetLink } from "./db.types";
import type { BudgetLink } from "./ui-contract";

export function budgetLinks(
  departmentSlug: string,
  rows: readonly DepartmentBudgetLink[],
  projectNames: ReadonlyMap<string, string>
): { departmentSlug: string; links: BudgetLink[] } {
  return {
    departmentSlug,
    links: rows.map((row) => ({
      projectId: row.finance_project_id,
      name: row.finance_project_id ? (projectNames.get(row.finance_project_id) ?? null) : null,
      budgetCents: row.budget_cents,
      spentCents: row.spend_cents,
      currency: "ZAR",
    })),
  };
}
