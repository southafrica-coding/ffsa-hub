import { describe, expect, it } from "vitest";
import { matchStalledSpend, type RemoteSpend } from "./xero-spend-reconcile";

const expected = {
  reference: "ffsa-expense-33333333-3333-4333-8333-333333333333",
  spentOn: "2026-11-08",
  amountCents: 1200,
  currency: "ZAR" as const,
};

function hit(over: Partial<RemoteSpend> = {}): RemoteSpend {
  return {
    bankTransactionId: "bt-1",
    reference: expected.reference,
    type: "SPEND",
    status: "AUTHORISED",
    date: "2026-11-08",
    currencyCode: "ZAR",
    total: 12,
    ...over,
  };
}

describe("matchStalledSpend", () => {
  it("accepts one SPEND that agrees on reference, date, currency and total", () => {
    expect(matchStalledSpend([hit()], expected)).toEqual({ ok: true, bankTransactionId: "bt-1" });
  });

  it("stays blocked when the read is missing, empty, repeated, or disagrees", () => {
    expect(matchStalledSpend(null, expected).ok).toBe(false);
    expect(matchStalledSpend([], expected)).toMatchObject({ reason: "not_found" });
    expect(matchStalledSpend([hit(), hit({ bankTransactionId: "bt-2" })], expected)).toMatchObject({ reason: "ambiguous" });
    expect(matchStalledSpend([hit({ total: 13 })], expected)).toMatchObject({ reason: "mismatch" });
    expect(matchStalledSpend([hit({ currencyCode: "USD" })], expected)).toMatchObject({ reason: "mismatch" });
    expect(matchStalledSpend([hit({ currencyCode: null })], expected)).toMatchObject({ reason: "mismatch" });
    expect(matchStalledSpend([hit({ date: "2026-11-07" })], expected)).toMatchObject({ reason: "mismatch" });
    expect(matchStalledSpend([hit({ type: "RECEIVE" })], expected)).toMatchObject({ reason: "mismatch" });
    expect(matchStalledSpend([hit({ status: "DELETED" })], expected)).toMatchObject({ reason: "mismatch" });
    expect(matchStalledSpend([hit({ reference: "other" })], expected)).toMatchObject({ reason: "not_found" });
    expect(matchStalledSpend([hit({ bankTransactionId: "  " })], expected)).toMatchObject({ reason: "unproven" });
  });
});
