import { describe, expect, it } from "vitest";
import { invoiceDueDate, suggestItemCode, xeroRegionForCurrency } from "./pay-later";

describe("pay-later helpers", () => {
  it("routes the invoice to the org matching the event currency", () => {
    expect(xeroRegionForCurrency("USD")).toBe("us");
    expect(xeroRegionForCurrency("ZAR")).toBe("za");
    expect(xeroRegionForCurrency(null)).toBe("za");
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
