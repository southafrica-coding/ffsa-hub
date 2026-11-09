/**
 * A team can have more than one budget. The updated budget model (PR #475)
 * is unique on organisation + owner + period + name, so a Slack receipt
 * has to pick the org and the fiscal period. It does not take "the" budget
 * for the team.
 *
 * Hub budget workbooks are South Africa / ZAR only. A dollar slip does not
 * open a US workbook. The receipt still belongs to the team's ZAR budget
 * in the fiscal period that contains the date. NPC versus USA is not read
 * from finance_orgs. Two ZAR budgets in that period are not guessed apart
 * unless the note names one of them.
 */

export type BudgetOrgKey = "npc" | "usa";

export type TeamBudgetRow = {
  id: string;
  name: string;
  status: string;
  /** npc when budgets.currency is ZAR. A USD row is not selected. */
  orgKey: BudgetOrgKey | null;
  /** budgets.currency, used when orgKey is absent. */
  currency: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  lines: { id: string; name: string }[];
};

export type ReceiptBook = {
  /** npc = FFSA NPC / ZAR, usa = FF USA Inc / USD. */
  org: BudgetOrgKey;
  expenseDate: string;
  /** Free text that may name the budget when org + period still leaves two. */
  nameHint: string | null;
};

export type BudgetSelection =
  | { ok: true; budget: TeamBudgetRow }
  | { ok: false; reason: "none" | "ambiguous" };

/**
 * The same gate as #475's assert_south_africa_budget_org: finance_orgs.key
 * npc, is_active, and record_currency ZAR. A ZAR budget currency and a
 * matching period id do not prove this. An inactive NPC row fails.
 */
export function isActiveSouthAfricaOrg(
  org: { key?: string | null; is_active?: boolean | null; record_currency?: string | null } | null | undefined
): boolean {
  return org?.key === "npc" && org.is_active === true && (org.record_currency ?? "").toUpperCase() === "ZAR";
}

/** Workbooks are the SA / ZAR org. The slip currency does not choose a US book. */
export function orgForReceiptCurrency(localCurrency: string | null | undefined): BudgetOrgKey {
  void localCurrency;
  return "npc";
}

export function regionForOrg(org: BudgetOrgKey | null): "za" | "us" {
  return org === "usa" ? "us" : "za";
}

/**
 * Confirmed spends post on the ZA bank-account path, in rand. A foreign
 * slip still uses the rand figure already collected. No FX rate is invented
 * here, and a USD workbook is not opened to store dollar cents.
 */
export function xeroBook(
  _org: BudgetOrgKey | null,
  args: {
    localCurrency: string | null;
    localAmount: number | null;
    zarAmount: number;
    zarConfirmed: boolean;
  }
): { region: "za" | "us"; currency: "ZAR"; amount: number; zarConfirmed: boolean } {
  return {
    region: "za",
    currency: "ZAR",
    amount: args.zarAmount,
    zarConfirmed: args.zarConfirmed,
  };
}

function orgMatches(row: TeamBudgetRow, org: BudgetOrgKey): boolean {
  if (row.orgKey === "npc" || row.orgKey === "usa") return row.orgKey === org;
  const currency = (row.currency ?? "").toUpperCase();
  if (org === "usa") return currency === "USD";
  return currency === "ZAR";
}

function inPeriod(date: string, start: string | null, end: string | null): boolean {
  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const from = start.slice(0, 10);
  const to = end.slice(0, 10);
  return date >= from && date <= to;
}

function nameHits(budgetName: string, hint: string): boolean {
  const name = budgetName.trim().toLowerCase();
  const text = hint.trim().toLowerCase();
  if (name.length < 3 || text.length < 3) return false;
  return text === name || text.includes(name);
}

/**
 * Live ZAR budgets for one team in the fiscal period that contains the
 * receipt date. A USD book is never chosen. Ambiguous when more than one
 * ZAR name remains.
 */
export function selectTeamBudget(rows: TeamBudgetRow[], book: ReceiptBook): BudgetSelection {
  let matched = rows.filter(
    (row) =>
      row.status !== "archived" &&
      orgMatches(row, "npc") &&
      inPeriod(book.expenseDate, row.periodStart, row.periodEnd)
  );
  // An approved budget wins over a draft or a submitted one in the same period.
  const approved = matched.filter((row) => row.status === "approved");
  if (approved.length) matched = approved;
  if (matched.length === 0) return { ok: false, reason: "none" };
  if (matched.length === 1) return { ok: true, budget: matched[0] };
  const hint = book.nameHint ?? "";
  const named = hint ? matched.filter((row) => nameHits(row.name, hint)) : [];
  if (named.length === 1) return { ok: true, budget: named[0] };
  return { ok: false, reason: "ambiguous" };
}
