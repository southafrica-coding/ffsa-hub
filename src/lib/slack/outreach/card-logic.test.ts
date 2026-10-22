import { describe, expect, it } from "vitest";
import {
  bankAmounts,
  cardConfirmBlocks,
  confirmWithBank,
  matchCardCandidates,
  pairCardNotices,
  reminderText,
  type CardCandidate,
} from "./card-logic";
import { amountLine, type Proposal, type ReceiptReading } from "./receipt-logic";

const notice = (over: Partial<ReceiptReading> = {}): ReceiptReading => ({
  document_kind: "card_payment_notification",
  is_receipt: false,
  legibility: "clear",
  vendor: "CHOPPIES GABORONE",
  date: "2026-11-02",
  total: null,
  currency: null,
  vat_amount: null,
  receipt_number: null,
  summary: "Card purchase",
  suggested_category: null,
  paid_by: "card",
  notes: null,
  bank_zar_total: 595.56,
  bank_zar_fee: 15.94,
  bank_foreign_amount: 420,
  bank_foreign_currency: "BWP",
  ...over,
});

const receipt: Proposal = {
  category_id: "c0",
  vendor: "Choppies",
  expense_date: "2026-11-02",
  description: "Groceries",
  local_currency: "BWP",
  local_amount: 420,
  exchange_rate: 0.7519,
  zar_amount: 558.6,
  rate_label: "today's market rate",
  cash_batch_id: null,
  payment_method: "card",
  receipt_code: null,
};

describe("bankAmounts", () => {
  it("splits the separate fee out of the total", () => {
    expect(bankAmounts(notice())).toEqual({ total: 595.56, fee: 15.94, purchase: 579.62 });
  });
  it("treats a fee that can't be right as no fee", () => {
    expect(bankAmounts(notice({ bank_zar_fee: 600 }))).toEqual({ total: 595.56, fee: 0, purchase: 595.56 });
    expect(bankAmounts(notice({ bank_zar_total: null }))).toBeNull();
  });
});

describe("confirmWithBank", () => {
  it("takes the rand from the bank and works out the rate", () => {
    const { proposal } = confirmWithBank(receipt, notice());
    expect(proposal).toMatchObject({ zar_amount: 579.62, zar_confirmed: true, bank_fee_zar: 15.94, payment_method: "card" });
    expect(proposal.exchange_rate).toBeCloseTo(420 / 579.62, 10);
    expect(amountLine(proposal)).toBe("P 420.00 → *R579.62* ✅ rand confirmed by bank");
  });
  it("stays an estimate when the bank's rand can't be read", () => {
    const { proposal, warnings } = confirmWithBank(receipt, notice({ bank_zar_total: null }));
    expect(proposal.zar_confirmed).toBeUndefined();
    expect(warnings[0]).toContain("estimate");
  });
});

describe("pairCardNotices", () => {
  const n = (foreignAmount: number | null, zarTotal = 100, foreignCurrency: string | null = "BWP") => ({ foreignAmount, foreignCurrency, zarTotal });

  it("pairs one receipt with one notification, flagging a mismatch", () => {
    expect(pairCardNotices([{ total: 420, currency: "BWP" }], [n(420)])).toEqual([{ receipt: 0, notice: 0, mismatch: false }]);
    expect(pairCardNotices([{ total: 420, currency: "BWP" }], [n(430)])).toEqual([{ receipt: 0, notice: 0, mismatch: true }]);
    // No foreign amount on the notification: nothing to check against.
    expect(pairCardNotices([{ total: 420, currency: "BWP" }], [n(null)])).toEqual([{ receipt: 0, notice: 0, mismatch: false }]);
  });

  it("matches several by amount and leaves the rest alone", () => {
    const pairs = pairCardNotices(
      [{ total: 420, currency: "BWP" }, { total: 88.5, currency: "BWP" }, { total: 1000, currency: "BWP" }],
      [n(88.5), n(420), n(55)]
    );
    expect(pairs).toEqual([
      { receipt: 0, notice: 1, mismatch: false },
      { receipt: 1, notice: 0, mismatch: false },
    ]);
  });

  it("pairs a rand receipt by the rand", () => {
    expect(pairCardNotices([{ total: 250, currency: "ZAR" }, { total: 99, currency: "ZAR" }], [n(null, 99, null), n(null, 250, null)])).toEqual([
      { receipt: 0, notice: 1, mismatch: false },
      { receipt: 1, notice: 0, mismatch: false },
    ]);
  });
});

describe("matchCardCandidates", () => {
  const c = (id: string, over: Partial<CardCandidate> = {}): CardCandidate => ({
    id,
    team_id: "t1",
    team_name: "Botswana",
    vendor: "Choppies",
    description: "Groceries",
    expense_date: "2026-11-02",
    local_amount: 420,
    local_currency: "BWP",
    zar_amount: 558.6,
    ...over,
  });

  it("finds the payment by foreign amount and currency, nearest date first", () => {
    const all = [c("far", { expense_date: "2026-10-28" }), c("other", { local_amount: 99 }), c("near"), c("usd", { local_currency: "USD" })];
    expect(matchCardCandidates(notice(), all).map((x) => x.id)).toEqual(["near", "far"]);
  });

  it("falls back to the rand when the bank shows no foreign amount", () => {
    const all = [c("close", { zar_amount: 560 }), c("way-off", { zar_amount: 900 })];
    expect(matchCardCandidates(notice({ bank_foreign_amount: null, bank_foreign_currency: null }), all).map((x) => x.id)).toEqual(["close"]);
  });

  it("ignores payments more than a week from the notification", () => {
    expect(matchCardCandidates(notice(), [c("old", { expense_date: "2026-10-01" })])).toEqual([]);
  });

  it("offers one button for one match, a menu for several", () => {
    const one = cardConfirmBlocks({ draftId: "d1", notice: notice(), candidates: [c("e1")], cancelActionId: "receipt_cancel" });
    const actions = one.find((b) => (b as { type: string }).type === "actions") as { elements: { action_id: string; value?: string }[] };
    expect(actions.elements[0]).toMatchObject({ action_id: "card_confirm", value: "d1|e1" });

    const many = cardConfirmBlocks({ draftId: "d1", notice: notice(), candidates: [c("e1"), c("e2")], cancelActionId: "receipt_cancel" });
    const menu = (many.find((b) => (b as { type: string }).type === "actions") as { elements: { type: string; options?: { value: string }[] }[] })
      .elements[0];
    expect(menu.type).toBe("static_select");
    expect(menu.options?.map((o) => o.value)).toEqual(["d1|e1", "d1|e2"]);
  });
});

describe("reminderText", () => {
  it("lists what's waiting", () => {
    const t = reminderText([
      { vendor: "Choppies", description: "Groceries", local_amount: 420, local_currency: "BWP", expense_date: "2026-11-02", team_name: "Botswana" },
    ]);
    expect(t).toContain("1 card payment is still waiting");
    expect(t).toContain("• Choppies — P 420.00 (2026-11-02, Botswana)");
  });
});
