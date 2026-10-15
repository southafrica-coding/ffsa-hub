import { describe, expect, it } from "vitest";
import { invoiceDueDate, suggestItemCode, xeroRegionForOrder } from "./pay-later-rules";

describe("pay-later helpers", () => {
  it("invoices USA buyers from the US org and everyone else from SA, whatever the currency", () => {
    expect(xeroRegionForOrder({ buyer_country: "United States", currency: "ZAR" })).toBe("us");
    expect(xeroRegionForOrder({ buyer_country: "South Africa", currency: "USD" })).toBe("za");
    expect(xeroRegionForOrder({ buyer_country: "Norway", currency: "USD" })).toBe("za");
    expect(xeroRegionForOrder({ buyer_country: "USA", currency: "USD" })).toBe("us");
  });

  it("routes orders from before buyers were asked by the event currency", () => {
    expect(xeroRegionForOrder({ buyer_country: null, currency: "USD" })).toBe("us");
    expect(xeroRegionForOrder({ buyer_country: "", currency: "ZAR" })).toBe("za");
    expect(xeroRegionForOrder({ buyer_country: null, currency: null })).toBe("za");
  });

  it("uses the due date, else the start date, never in the past", () => {
    expect(invoiceDueDate({ pay_later_due_date: "2026-11-30", start_date: "2026-12-05" }, "2026-10-15")).toBe("2026-11-30");
    expect(invoiceDueDate({ pay_later_due_date: null, start_date: "2026-12-05" }, "2026-10-15")).toBe("2026-12-05");
    expect(invoiceDueDate({ pay_later_due_date: null, start_date: "2026-09-01" }, "2026-10-15")).toBe("2026-10-15");
  });

  it("suggests a short item code from the title", () => {
    expect(suggestItemCode("FF Global Leaders Gathering")).toBe("FFGLG");
    expect(suggestItemCode("Preachers 2026")).toBe("PREACHERS26");
    expect(suggestItemCode("Wild Ones Youth Camp")).toBe("WOYC");
  });
});
