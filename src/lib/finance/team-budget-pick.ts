/**
 * A team can have more than one budget. The updated budget model (PR #475)
 * is unique on organisation + owner + period + name, so a Slack receipt
 * has to pick the org and the fiscal period. It does not take "the" budget
 * for the team.
 *
 * FFSA NPC records ZAR. FF USA Inc records USD. A dollar slip is the USA
 * budget; every other slip is the NPC budget, in the period that contains
 * the receipt date. Two budgets still in that org and period are not guessed
 * apart unless the note names one of them.
 */

export type BudgetOrgKey = "npc" | "usa";

export type TeamBudgetRow = {
  id: string;
  name: string;
  status: string;
  /** finance_orgs.key. Null when the row has no org yet. */
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

/** A USD slip is recorded on FF USA Inc. Everything else is ZAR on FFSA NPC. */
export function orgForReceiptCurrency(localCurrency: string | null | undefined): BudgetOrgKey {
  return (localCurrency ?? "").toUpperCase() === "USD" ? "usa" : "npc";
}

export function regionForOrg(org: BudgetOrgKey | null): "za" | "us" {
  return org === "usa" ? "us" : "za";
}

/**
 * The amount Xero is asked to record, in the org's own currency.
 * NPC gets the rand figure. USA gets the dollar figure on the slip,
 * not a rand conversion.
 */
export function xeroBook(
  org: BudgetOrgKey | null,
  args: {
    localCurrency: string | null;
    localAmount: number | null;
    zarAmount: number;
    zarConfirmed: boolean;
  }
): { region: "za" | "us"; currency: "ZAR" | "USD"; amount: number; zarConfirmed: boolean } {
  if (org === "usa") {
    return {
      region: "us",
      currency: "USD",
      amount: Number(args.localAmount),
      zarConfirmed: (args.localCurrency ?? "").toUpperCase() === "USD" && Number(args.localAmount) > 0,
    };
  }
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
 * Live budgets for one team, narrowed to one org and the fiscal period
 * that contains the receipt date. Ambiguous when more than one name remains.
 */
export function selectTeamBudget(rows: TeamBudgetRow[], book: ReceiptBook): BudgetSelection {
  const matched = rows.filter(
    (row) =>
      row.status !== "archived" &&
      orgMatches(row, book.org) &&
      inPeriod(book.expenseDate, row.periodStart, row.periodEnd)
  );
  if (matched.length === 0) return { ok: false, reason: "none" };
  if (matched.length === 1) return { ok: true, budget: matched[0] };
  const hint = book.nameHint ?? "";
  const named = hint ? matched.filter((row) => nameHits(row.name, hint)) : [];
  if (named.length === 1) return { ok: true, budget: named[0] };
  return { ok: false, reason: "ambiguous" };
}
