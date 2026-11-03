// The add/edit expense form: its rules and the exact payload it sends.
//
// Mirrors the website's expense dialog (src/app/(admin)/finance/outreach/
// [teamId]/expenses-tab.tsx): budget line, date and amount are required, a
// receipt is required when adding, card payments abroad carry the
// "rand from my bank app" flag (migration 265), and foreign cash is priced
// from the team's cash pulls (migration 263). Two deliberate differences, both
// because the database requires them (migration 008 NOT NULL columns) and
// the website's own server code always fills them: a description is
// required, and local currency/amount are always sent (rand when local).

import { z } from "zod";

import { normaliseCurrency } from "./money";
import { strings } from "./strings";
import type { CashPull, Expense } from "./types";

export const PAYMENT_METHODS = ["cash", "card", "bank_transfer", "reimbursement", "prepayment"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type ExpenseForm = {
  category_id: string;
  expense_date: string;
  description: string;
  payment_method: PaymentMethod;
  /** Currency the amount was paid in. */
  currency: string;
  /** Amount in `currency`, as typed. */
  amount: string;
  /** Rand amount, as typed (only used when `currency` isn't ZAR). */
  zar_amount: string;
  zar_confirmed: boolean;
  vendor: string;
  purchaser: string;
  receipt_code: string;
  country: string;
  notes: string;
};

export type ExpenseField = keyof ExpenseForm | "receipts";
export type FieldErrors = Partial<Record<ExpenseField, string>>;

export function todayIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return todayIso(new Date(y, m - 1, d + days));
}

export function emptyForm(opts: { currency?: string | null; country?: string | null; now?: Date } = {}): ExpenseForm {
  return {
    category_id: "",
    expense_date: todayIso(opts.now),
    description: "",
    payment_method: "cash",
    currency: normaliseCurrency(opts.currency),
    amount: "",
    zar_amount: "",
    zar_confirmed: false,
    vendor: "",
    purchaser: "",
    receipt_code: "",
    country: opts.country ?? "",
    notes: "",
  };
}

export function formFromExpense(e: Expense): ExpenseForm {
  const currency = normaliseCurrency(e.local_currency);
  const local = e.local_amount ?? e.zar_amount;
  return {
    category_id: e.category_id,
    expense_date: e.expense_date.slice(0, 10),
    description: e.description ?? "",
    payment_method: (PAYMENT_METHODS as readonly string[]).includes(e.payment_method)
      ? (e.payment_method as PaymentMethod)
      : "cash",
    currency,
    amount: String(currency === "ZAR" ? e.zar_amount : local),
    zar_amount: currency === "ZAR" ? "" : String(e.zar_amount),
    zar_confirmed: e.zar_confirmed,
    vendor: e.vendor ?? "",
    purchaser: e.purchaser ?? "",
    receipt_code: e.receipt_code ?? "",
    country: e.country ?? "",
    notes: e.notes ?? "",
  };
}

// ── Amount rules (same as the website's updateField) ────────────────────────

/** "120,50" (comma keyboards) and "120.50" both parse; anything else is null. */
export function parseAmount(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Number(s);
}

export const isForeign = (f: Pick<ExpenseForm, "currency">) => normaliseCurrency(f.currency) !== "ZAR";
/** Card abroad: the rand comes from the bank app (migration 265). */
export const isCardAbroad = (f: Pick<ExpenseForm, "currency" | "payment_method">) =>
  f.payment_method === "card" && isForeign(f);
/** Foreign cash is charged to the team's cash pulls, oldest first (migration 263). */
export const isPricedByPulls = (f: Pick<ExpenseForm, "currency" | "payment_method">) =>
  f.payment_method === "cash" && isForeign(f);

/** The newest cash pull in that currency with a usable rate. */
export function newestPull(pulls: CashPull[], currency: string): CashPull | undefined {
  const cur = normaliseCurrency(currency);
  return [...pulls]
    .filter((p) => normaliseCurrency(p.local_currency) === cur && (p.exchange_rate ?? 0) > 0)
    .sort((a, b) => b.batch_date.localeCompare(a.batch_date))[0];
}

/**
 * The rand figure the form will send, and whether the person may type it.
 * Foreign cash with a pull is an estimate the database replaces with the
 * exact oldest-first figure on save, so it isn't typed.
 */
export function derivedZar(f: ExpenseForm, pulls: CashPull[]): { zar: number | null; editable: boolean; fromPull: boolean } {
  const amount = parseAmount(f.amount);
  if (!isForeign(f)) return { zar: amount, editable: false, fromPull: false };
  if (isPricedByPulls(f)) {
    const pull = newestPull(pulls, f.currency);
    if (pull?.exchange_rate) {
      return { zar: amount === null ? null : Math.round((amount / pull.exchange_rate) * 100) / 100, editable: false, fromPull: true };
    }
  }
  return { zar: parseAmount(f.zar_amount), editable: true, fromPull: false };
}

/** One field changed. Typing the rand for a card payment abroad means it came from the bank app (as on the web). */
export function updateForm<K extends keyof ExpenseForm>(f: ExpenseForm, field: K, value: ExpenseForm[K]): ExpenseForm {
  const next = { ...f, [field]: value };
  if (field === "currency") next.currency = String(value).toUpperCase().slice(0, 3);
  if (field === "zar_amount" && isCardAbroad(next)) next.zar_confirmed = true;
  return next;
}

// ── Validation + payload ────────────────────────────────────────────────────

const isoDate = z.string().refine((s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
});

export type ExpensePayload = {
  team_id: string;
  category_id: string;
  expense_date: string;
  receipt_code: string | null;
  vendor: string | null;
  description: string;
  purchaser: string | null;
  payment_method: PaymentMethod;
  country: string | null;
  local_currency: string;
  local_amount: number;
  zar_amount: number;
  exchange_rate: number;
  zar_confirmed: boolean;
  zar_estimate: number | null;
  zar_confirmed_at: string | null;
  cash_batch_id: null;
  notes: string | null;
};

export type ValidateResult = { ok: true; payload: ExpensePayload } | { ok: false; errors: FieldErrors };

const orNull = (s: string) => (s.trim() ? s.trim() : null);

export function validateExpense(
  f: ExpenseForm,
  ctx: { teamId: string; pulls: CashPull[]; receiptCount: number; isNew: boolean; now?: Date },
): ValidateResult {
  const errors: FieldErrors = {};
  if (!f.category_id) errors.category_id = strings.validation.category;
  if (!isoDate.safeParse(f.expense_date.trim()).success) errors.expense_date = strings.validation.date;
  if (!f.description.trim()) errors.description = strings.validation.description;
  if (!/^[A-Za-z]{3}$/.test(f.currency.trim())) errors.currency = strings.validation.currency;
  const amount = parseAmount(f.amount);
  if (amount === null) errors.amount = strings.validation.amount;
  const { zar } = derivedZar(f, ctx.pulls);
  if (amount !== null && isForeign(f) && zar === null) errors.zar_amount = strings.validation.zarAmount;
  if (ctx.isNew && ctx.receiptCount === 0) errors.receipts = strings.expense.receiptRequired;
  if (Object.keys(errors).length > 0 || amount === null || zar === null) return { ok: false, errors };

  const currency = normaliseCurrency(f.currency);
  const cardAbroad = isCardAbroad(f);
  const confirmed = cardAbroad && f.zar_confirmed;
  return {
    ok: true,
    payload: {
      team_id: ctx.teamId,
      category_id: f.category_id,
      expense_date: f.expense_date.trim(),
      receipt_code: orNull(f.receipt_code),
      vendor: orNull(f.vendor),
      description: f.description.trim(),
      purchaser: orNull(f.purchaser),
      payment_method: f.payment_method,
      country: orNull(f.country),
      local_currency: currency,
      local_amount: amount,
      zar_amount: zar,
      // exchange_rate = local / zar, as on the website.
      exchange_rate: currency === "ZAR" || zar <= 0 ? 1 : Number((amount / zar).toFixed(6)),
      zar_confirmed: !cardAbroad || confirmed,
      zar_estimate: cardAbroad && !confirmed ? zar : null,
      zar_confirmed_at: confirmed ? (ctx.now ?? new Date()).toISOString() : null,
      // Set by the database for foreign cash (oldest pull first).
      cash_batch_id: null,
      notes: orNull(f.notes),
    },
  };
}
