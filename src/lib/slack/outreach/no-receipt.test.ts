import { describe, expect, it } from "vitest";
import {
  ACTION_REPAY,
  classifyBareMessage,
  parseRepayValue,
  parseSpendClaim,
  repayValue,
  repaymentBlocks,
  repaymentSentence,
} from "./no-receipt";

describe("classifyBareMessage", () => {
  it("keeps budget questions for the assistant", () => {
    expect(classifyBareMessage("how much have we spent on food?")).toBe("question");
    expect(classifyBareMessage("What's left in transport")).toBe("question");
    expect(classifyBareMessage("did we already log the diesel?")).toBe("question");
  });

  it("treats a spend with no photo as a repayment, not an expense", () => {
    expect(classifyBareMessage("I spent R180 on a taxi, no receipt")).toBe("no_receipt");
    expect(classifyBareMessage("lost the receipt for the airtime")).toBe("no_receipt");
    expect(classifyBareMessage("we paid 50 for parking")).toBe("no_receipt");
  });

  it("leaves ordinary chat alone", () => {
    expect(classifyBareMessage("thanks")).toBe("other");
    expect(classifyBareMessage("the team lands on Tuesday")).toBe("other");
  });
});

describe("parseSpendClaim", () => {
  it("reads rand, dollars and pula", () => {
    expect(parseSpendClaim("no receipt, R180 for a taxi")).toMatchObject({ amount: 180, currency: "ZAR", description: "for a taxi" });
    expect(parseSpendClaim("spent $12.50 on coffee")).toMatchObject({ amount: 12.5, currency: "USD" });
    expect(parseSpendClaim("paid P40 for bread")).toMatchObject({ amount: 40, currency: "BWP" });
  });

  it("returns null when there is no amount to repay", () => {
    expect(parseSpendClaim("lost the receipt")).toBeNull();
  });
});

describe("repayment card", () => {
  it("states the rule and does not offer a Xero or budget action", () => {
    const text = repaymentSentence({ amount: 180, currency: "ZAR", description: "for a taxi" }, "Botswana");
    expect(text).toMatch(/you repay/);
    expect(text).toMatch(/not sent to Xero/);
    expect(text).toMatch(/Botswana/);
    const value = repayValue({ amountCents: 18000, currency: "ZAR", teamId: "team-1", description: "for a taxi" });
    const blocks = JSON.stringify(repaymentBlocks(text, value));
    expect(blocks).toContain(ACTION_REPAY);
    expect(blocks).not.toContain("receipt_log");
    expect(parseRepayValue(value)).toEqual({
      amountCents: 18000,
      currency: "ZAR",
      teamId: "team-1",
      description: "for a taxi",
    });
  });

  it("asks for an amount instead of confirming a blank one", () => {
    const blocks = repaymentBlocks(repaymentSentence(null, null), null);
    expect(JSON.stringify(blocks)).not.toContain(ACTION_REPAY);
  });
});
