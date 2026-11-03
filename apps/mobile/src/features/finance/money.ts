// Money formatting and budget maths. Pure, no React: unit-tested alone.
//
// Formatting is done by hand rather than with Intl so the phone shows the
// same thing on every platform and Hermes/ICU version: "R 38 800" with a
// space between thousands (the web's rands()), and a full stop before cents.
// The spaces are no-break spaces so an amount never splits across lines.

const NBSP = " ";

export type MoneyOptions = {
  /** Show cents (default true). Budget summaries round to whole units. */
  cents?: boolean;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function groupThousands(whole: string) {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** Parse what the database or a form gives us (number, numeric string, null). */
export function toNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function normaliseCurrency(code: string | null | undefined): string {
  const c = (code ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : "ZAR";
}

/** "R 1 234.50", "−R 80", "USD 12.00". */
export function formatMoney(amount: number, currency?: string | null, opts: MoneyOptions = {}): string {
  const cents = opts.cents ?? true;
  const code = normaliseCurrency(currency);
  const value = cents ? round2(amount) : Math.round(amount);
  const negative = value < 0;
  const abs = Math.abs(value);
  const [whole, frac] = (cents ? abs.toFixed(2) : String(abs)).split(".");
  const number = groupThousands(whole) + (frac ? `.${frac}` : "");
  const symbol = code === "ZAR" ? "R" : code;
  return `${negative ? "−" : ""}${symbol}${NBSP}${number}`;
}

/** What a screen reader should say: "1234.50 rand", "minus 80 rand". */
export function moneyLabel(amount: number, currency?: string | null, opts: MoneyOptions = {}): string {
  const cents = opts.cents ?? true;
  const code = normaliseCurrency(currency);
  const value = cents ? round2(amount) : Math.round(amount);
  const abs = Math.abs(value);
  const text = cents && abs % 1 !== 0 ? abs.toFixed(2) : String(Math.round(abs));
  const unit = code === "ZAR" ? "rand" : code;
  return `${value < 0 ? "minus " : ""}${text} ${unit}`;
}

// ── Budget maths ────────────────────────────────────────────────────────────

export type BudgetFigures = {
  total: number;
  spent: number;
  remaining: number;
  /** spent / total, 0..∞ (over 1 when overspent); null with no budget. */
  ratio: number | null;
  /** Percent spent, one decimal, rounded DOWN like the web's fee bar, so
   *  nobody reads 100% before the last cent is gone. Null with no budget. */
  pctSpent: number | null;
  over: boolean;
};

export function budgetFigures(total: number, spent: number): BudgetFigures {
  const t = round2(total);
  const s = round2(spent);
  const remaining = round2(t - s);
  if (t <= 0) {
    return { total: t, spent: s, remaining, ratio: null, pctSpent: null, over: s > 0 };
  }
  const ratio = s / t;
  return {
    total: t,
    spent: s,
    remaining,
    ratio,
    pctSpent: Math.floor(ratio * 1000) / 10,
    over: s > t,
  };
}

/** Bar fill 0..1 (an overspent bar is simply full; the text says "over"). */
export function barFill(ratio: number | null): number {
  if (ratio === null || !Number.isFinite(ratio)) return 0;
  return Math.min(1, Math.max(0, ratio));
}

export type LineInput = { category_id: string; budget_amount_zar: unknown };
export type ExpenseInput = { category_id: string; zar_amount: unknown };
export type CategoryInput = { id: string; name: string; sort_order?: number | null };

export type BudgetLine = BudgetFigures & { categoryId: string; name: string; sortOrder: number; count: number };

/**
 * One row per budget line (category) that has a budget or any spending, in
 * the categories' order. Expenses are charged to a category; the team's
 * budget lines roll up into per-category totals (outreach_team_budgets).
 */
export function budgetLines(
  categories: CategoryInput[],
  budgets: LineInput[],
  expenses: ExpenseInput[],
): BudgetLine[] {
  const budgetBy = new Map<string, number>();
  for (const b of budgets) budgetBy.set(b.category_id, (budgetBy.get(b.category_id) ?? 0) + toNumber(b.budget_amount_zar));
  const spentBy = new Map<string, { sum: number; count: number }>();
  for (const e of expenses) {
    const cur = spentBy.get(e.category_id) ?? { sum: 0, count: 0 };
    spentBy.set(e.category_id, { sum: cur.sum + toNumber(e.zar_amount), count: cur.count + 1 });
  }
  const byId = new Map(categories.map((c) => [c.id, c]));
  const ids = new Set([...budgetBy.keys(), ...spentBy.keys()]);
  const rows: BudgetLine[] = [];
  for (const id of ids) {
    const cat = byId.get(id);
    const spent = spentBy.get(id);
    rows.push({
      ...budgetFigures(budgetBy.get(id) ?? 0, spent?.sum ?? 0),
      categoryId: id,
      name: cat?.name ?? "Other",
      sortOrder: cat?.sort_order ?? Number.MAX_SAFE_INTEGER,
      count: spent?.count ?? 0,
    });
  }
  return rows.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export function sumBy<T>(rows: T[], pick: (row: T) => unknown): number {
  return round2(rows.reduce((s, r) => s + toNumber(pick(r)), 0));
}
