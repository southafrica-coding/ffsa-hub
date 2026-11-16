import {
  derivedZar,
  emptyForm,
  formFromExpense,
  isCardAbroad,
  isPricedByPulls,
  newestPull,
  parseAmount,
  shiftIso,
  todayIso,
  updateForm,
  validateExpense,
  type ExpenseForm,
} from "../expense-form";
import { strings } from "../strings";
import { expenseSchema, type CashPull } from "../types";

const TEAM = "team-1";
const NOW = new Date("2026-11-03T09:30:00.000Z");
const base: ExpenseForm = {
  ...emptyForm({ now: new Date(2026, 10, 3) }),
  category_id: "cat-food",
  description: "Bread and milk",
  amount: "120.50",
};
const ctx = (over: Partial<Parameters<typeof validateExpense>[1]> = {}) => ({
  teamId: TEAM,
  pulls: [] as CashPull[],
  receiptCount: 1,
  isNew: true,
  now: NOW,
  ...over,
});

describe("dates", () => {
  it("uses the phone's local calendar day", () => {
    expect(todayIso(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(shiftIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(emptyForm({ now: new Date(2026, 10, 3) }).expense_date).toBe("2026-11-03");
  });
});

describe("parseAmount", () => {
  it.each([
    ["120", 120],
    ["120.5", 120.5],
    ["120,50", 120.5],
    [" 1 200.00 ", 1200],
    ["0", 0],
  ])("reads %p", (raw, n) => expect(parseAmount(raw)).toBe(n));

  it.each(["", "abc", "-5", "1.234", "1e3", "12.3.4"])("refuses %p", (raw) => expect(parseAmount(raw)).toBeNull());
});

describe("validateExpense: required fields (as on the website)", () => {
  it("builds the website's payload for a plain rand expense", () => {
    const v = validateExpense(base, ctx());
    expect(v).toEqual({
      ok: true,
      payload: {
        team_id: TEAM,
        category_id: "cat-food",
        expense_date: "2026-11-03",
        receipt_code: null,
        vendor: null,
        description: "Bread and milk",
        purchaser: null,
        payment_method: "cash",
        country: null,
        local_currency: "ZAR",
        local_amount: 120.5,
        zar_amount: 120.5,
        exchange_rate: 1,
        zar_confirmed: true,
        zar_estimate: null,
        zar_confirmed_at: null,
        cash_batch_id: null,
        notes: null,
      },
    });
  });

  it("names every missing field in plain words", () => {
    const v = validateExpense({ ...base, category_id: "", description: " ", amount: "", expense_date: "3 Nov" }, ctx({ receiptCount: 0 }));
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors).toEqual({
      category_id: strings.validation.category,
      description: strings.validation.description,
      amount: strings.validation.amount,
      expense_date: strings.validation.date,
      receipts: strings.expense.receiptRequired,
    });
  });

  it("rejects dates that don't exist", () => {
    const v = validateExpense({ ...base, expense_date: "2026-02-30" }, ctx());
    expect(v.ok).toBe(false);
  });

  it("needs a receipt to add, not to edit (as on the website)", () => {
    expect(validateExpense(base, ctx({ receiptCount: 0 })).ok).toBe(false);
    expect(validateExpense(base, ctx({ receiptCount: 0, isNew: false })).ok).toBe(true);
  });

  it("refuses a currency that isn't three letters", () => {
    const v = validateExpense({ ...base, currency: "R" }, ctx());
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.currency).toBe(strings.validation.currency);
  });

  it("trims text and keeps optional fields", () => {
    const v = validateExpense({ ...base, vendor: "  Shoprite ", notes: "Team lunch", receipt_code: "R001", purchaser: "Sample Person 199" }, ctx());
    expect(v.ok && v.payload).toMatchObject({ vendor: "Shoprite", notes: "Team lunch", receipt_code: "R001", purchaser: "Sample Person 199" });
  });
});

describe("abroad: card payments and foreign cash", () => {
  const pulls: CashPull[] = [
    { batch_date: "2026-10-01", local_currency: "BIF", exchange_rate: 150 },
    { batch_date: "2026-10-20", local_currency: "BIF", exchange_rate: 160 },
    { batch_date: "2026-10-25", local_currency: "USD", exchange_rate: 0 },
  ];

  it("knows a card abroad from foreign cash", () => {
    expect(isCardAbroad({ payment_method: "card", currency: "USD" })).toBe(true);
    expect(isCardAbroad({ payment_method: "card", currency: "ZAR" })).toBe(false);
    expect(isPricedByPulls({ payment_method: "cash", currency: "BIF" })).toBe(true);
  });

  it("prices foreign cash from the newest pull in that currency (an estimate the database replaces)", () => {
    expect(newestPull(pulls, "bif")?.exchange_rate).toBe(160);
    expect(newestPull(pulls, "USD")).toBeUndefined();
    const f = { ...base, currency: "BIF", amount: "16000" };
    expect(derivedZar(f, pulls)).toEqual({ zar: 100, editable: false, fromPull: true });
    const v = validateExpense(f, ctx({ pulls }));
    expect(v.ok && v.payload).toMatchObject({ local_currency: "BIF", local_amount: 16000, zar_amount: 100, exchange_rate: 160, cash_batch_id: null });
  });

  it("asks for the rand when there's no pull to price from", () => {
    const f = { ...base, currency: "USD", amount: "10" };
    expect(derivedZar(f, pulls)).toEqual({ zar: null, editable: true, fromPull: false });
    const v = validateExpense(f, ctx({ pulls }));
    expect(!v.ok && v.errors.zar_amount).toBe(strings.validation.zarAmount);
    const ok = validateExpense({ ...f, zar_amount: "185" }, ctx({ pulls }));
    expect(ok.ok && ok.payload).toMatchObject({ zar_amount: 185, exchange_rate: Number((10 / 185).toFixed(6)) });
  });

  it("marks an unconfirmed card payment abroad as an estimate", () => {
    const f = { ...base, payment_method: "card" as const, currency: "USD", amount: "10", zar_amount: "185" };
    const v = validateExpense({ ...f, zar_confirmed: false }, ctx());
    expect(v.ok && v.payload).toMatchObject({ zar_confirmed: false, zar_estimate: 185, zar_confirmed_at: null });
  });

  it("records when a card payment's rand was confirmed from the bank app", () => {
    const f = { ...base, payment_method: "card" as const, currency: "USD", amount: "10", zar_amount: "185", zar_confirmed: true };
    const v = validateExpense(f, ctx());
    expect(v.ok && v.payload).toMatchObject({ zar_confirmed: true, zar_estimate: null, zar_confirmed_at: NOW.toISOString() });
  });

  it("typing the rand for a card abroad ticks 'from my bank app' (as on the website)", () => {
    const f = updateForm({ ...base, payment_method: "card", currency: "USD" }, "zar_amount", "185");
    expect(f.zar_confirmed).toBe(true);
    const cash = updateForm({ ...base, currency: "USD" }, "zar_amount", "185");
    expect(cash.zar_confirmed).toBe(false);
  });

  it("upper-cases and trims the currency as it's typed", () => {
    expect(updateForm(base, "currency", "usdx").currency).toBe("USD");
  });
});

describe("formFromExpense", () => {
  it("round-trips an expense from the server into the form", () => {
    const e = expenseSchema.parse({
      id: "e1",
      team_id: TEAM,
      category_id: "cat-food",
      expense_date: "2026-10-31",
      description: "Taxi",
      payment_method: "card",
      local_currency: "USD",
      local_amount: "10.00",
      zar_amount: "185.00",
      zar_confirmed: false,
      vendor: null,
    });
    const f = formFromExpense(e);
    expect(f).toMatchObject({ currency: "USD", amount: "10", zar_amount: "185", payment_method: "card", zar_confirmed: false, expense_date: "2026-10-31" });
    expect(validateExpense(f, ctx({ isNew: false })).ok).toBe(true);
  });

  it("treats an unknown payment method as cash", () => {
    const e = expenseSchema.parse({ id: "e1", team_id: TEAM, category_id: "c", expense_date: "2026-10-31", payment_method: "crypto", zar_amount: 5 });
    expect(formFromExpense(e).payment_method).toBe("cash");
  });
});
