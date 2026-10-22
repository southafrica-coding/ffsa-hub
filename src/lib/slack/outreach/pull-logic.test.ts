import { describe, expect, it } from "vitest";
import {
  buildPullProposal,
  missingForPull,
  parsePullChange,
  parseTypedPull,
  pullCardBlocks,
  pullLine,
  rateText,
} from "./pull-logic";
import type { ReceiptReading } from "./receipt-logic";

const TODAY = "2026-11-03";

const notice = (over: Partial<ReceiptReading> = {}): ReceiptReading => ({
  document_kind: "atm_withdrawal_notification",
  is_receipt: false,
  legibility: "clear",
  vendor: null,
  date: "2026-11-02",
  total: null,
  currency: null,
  vat_amount: null,
  receipt_number: null,
  summary: "ATM withdrawal",
  suggested_category: null,
  paid_by: "unknown",
  notes: null,
  bank_zar_total: 2873.3,
  bank_zar_fee: 65,
  bank_foreign_amount: 500000,
  bank_foreign_currency: "BIF",
  ...over,
});

describe("parseTypedPull", () => {
  it("reads the cash and currency people type", () => {
    expect(parseTypedPull("pulled 500000 BIF")).toEqual({ amount: 500000, currency: "BIF" });
    expect(parseTypedPull("got 500 000 bif")).toEqual({ amount: 500000, currency: "BIF" });
    expect(parseTypedPull("BIF 1,200.50")).toEqual({ amount: 1200.5, currency: "BIF" });
    expect(parseTypedPull("2000")).toEqual({ amount: 2000, currency: null });
    expect(parseTypedPull(null)).toEqual({ amount: null, currency: null });
  });

  it("doesn't take ZAR or ordinary words as the cash currency", () => {
    expect(parseTypedPull("the ATM gave 2000 pula, ZAR out").currency).toBeNull();
    expect(parseTypedPull("got 2000 BWP for the team").currency).toBe("BWP");
  });
});

describe("buildPullProposal", () => {
  it("takes everything from a full notification", () => {
    const { proposal, warnings } = buildPullProposal({ reading: notice(), userNote: null, fallbackCurrency: null, today: TODAY });
    expect(proposal).toEqual({ batch_date: "2026-11-02", local_currency: "BIF", local_amount: 500000, zar_out: 2873.3, bank_fee: 65 });
    expect(warnings).toEqual([]);
    expect(missingForPull(proposal)).toEqual([]);
  });

  it("uses the typed cash when the notification only shows rand", () => {
    const { proposal } = buildPullProposal({
      reading: notice({ bank_foreign_amount: null, bank_foreign_currency: null, bank_zar_fee: null }),
      userNote: "pulled 500000 BIF",
      fallbackCurrency: "BWP",
      today: TODAY,
    });
    expect(proposal).toMatchObject({ local_currency: "BIF", local_amount: 500000, zar_out: 2873.3, bank_fee: 0 });
  });

  it("falls back to the team's currency and asks for what's missing", () => {
    const { proposal, warnings } = buildPullProposal({
      reading: notice({ bank_foreign_amount: null, bank_foreign_currency: null }),
      userNote: null,
      fallbackCurrency: "BIF",
      today: TODAY,
    });
    expect(proposal.local_currency).toBe("BIF");
    expect(proposal.local_amount).toBeNull();
    expect(warnings[0]).toContain("How much cash did you get?");
    expect(missingForPull(proposal)).toEqual(["the cash you got"]);
  });

  it("drops a fee that can't be right", () => {
    const { proposal, warnings } = buildPullProposal({ reading: notice({ bank_zar_fee: 3000 }), userNote: null, fallbackCurrency: null, today: TODAY });
    expect(proposal.bank_fee).toBe(0);
    expect(warnings).toContain("The fee looked bigger than the total — check it.");
  });
});

describe("pull card", () => {
  const p = { batch_date: "2026-11-02", local_currency: "BIF", local_amount: 500000, zar_out: 2873.3, bank_fee: 65 };

  it("shows the worked-out rate without the fee", () => {
    expect(pullLine(p)).toBe("500 000.00 BIF for R2 873.30 (incl. R65.00 fee) → *178.04 BIF per R1*");
  });

  it("shows strong currencies as rand per unit", () => {
    expect(rateText(0.054288, "USD")).toBe("R18.42 per USD");
    expect(rateText(178.0437, "BIF")).toBe("178.04 BIF per R1");
  });

  it("names the team on the button", () => {
    const blocks = pullCardBlocks({ draftId: "d1", senderName: "Jack", proposal: p, warnings: [], team: { id: "t1", name: "Burundi" } });
    const actions = blocks.find((b) => (b as { type: string }).type === "actions") as {
      elements: { action_id: string; value: string; text: { text: string } }[];
    };
    expect(actions.elements[0]).toMatchObject({ action_id: "receipt_log", value: "d1", text: { text: "✅ Log pull to Burundi" } });
  });
});

describe("parsePullChange", () => {
  const values = (over: Record<string, unknown> = {}) => ({
    date: { v: { selected_date: "2026-11-02" } },
    currency: { v: { selected_option: { value: "BIF" } } },
    cash: { v: { value: "500 000" } },
    zar: { v: { value: "2873,30" } },
    fee: { v: { value: "" } },
    ...over,
  });

  it("accepts the form", () => {
    expect(parsePullChange(values())).toEqual({
      ok: true,
      proposal: { batch_date: "2026-11-02", local_currency: "BIF", local_amount: 500000, zar_out: 2873.3, bank_fee: 0 },
    });
  });

  it("rejects a fee at or over the total", () => {
    const r = parsePullChange(values({ fee: { v: { value: "2873.30" } } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.fee).toBeTruthy();
  });
});
