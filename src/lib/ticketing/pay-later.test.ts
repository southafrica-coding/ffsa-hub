import { describe, expect, it } from "vitest";
import { invoiceDueDate, suggestItemCode, xeroRegionForOrder, missingItemOrgs } from "./pay-later-rules";
import { invoiceFailureAlertText } from "./pay-later-alerts";

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

  it("finds the Xero orgs missing an event's item (the FF Global failure)", () => {
    expect(missingItemOrgs("FFGBLG", { za: ["OTHER"], us: ["FFGBLG"] })).toEqual(["za"]);
    expect(missingItemOrgs("ffgblg", { za: ["FFGBLG"], us: ["FFGBLG"] })).toEqual([]);
    expect(missingItemOrgs(null, { za: ["X"], us: ["Y"] })).toEqual(["za", "us"]);
  });

  it("doesn't report an org it couldn't read as missing", () => {
    expect(missingItemOrgs("FFGBLG", { za: null, us: ["FFGBLG"] })).toEqual([]);
  });

  it("tells staff who, why and where to retry", () => {
    const text = invoiceFailureAlertText({
      eventId: "ev1",
      eventTitle: "FF Global",
      buyerName: "Layton MacCabe",
      buyerEmail: "layton@ffhalifax.com",
      country: "Canada",
      error: "SA Xero has no item FFGBLG",
    });
    expect(text).toContain("Layton MacCabe (layton@ffhalifax.com, Canada)");
    expect(text).toContain("SA Xero has no item FFGBLG");
    expect(text).toContain("/events/ev1?tab=orders");
  });
});
