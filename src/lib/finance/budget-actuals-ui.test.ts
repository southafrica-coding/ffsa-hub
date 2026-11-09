import { describe, expect, it } from "vitest";
import {
  actualAmountLabel,
  actualsTotalCents,
  interpretActuals,
  parseBudgetActuals,
} from "./budget-actuals-ui";

const ready = {
  budgetId: "b1",
  name: "Botswana",
  currency: "ZAR",
  source: "xero",
  period: { start: "2026-01-01", end: "2026-12-31" },
  region: "za",
  lines: [
    { lineId: "l1", name: "Food", plannedCents: 100000, actualCents: 18000, differenceCents: 82000 },
    { lineId: "l2", name: "Fuel", plannedCents: 5000, actualCents: null, differenceCents: null },
  ],
  unmatched: { count: 1, cents: 400 },
  xero: { ok: true, partial: false },
};

describe("parseBudgetActuals", () => {
  it("keeps an uncoded line unknown instead of turning it into zero", () => {
    const parsed = parseBudgetActuals(ready);
    expect(parsed?.lines[1]).toMatchObject({ actualCents: null, differenceCents: null });
    expect(parsed?.source).toBe("xero");
  });

  it("refuses a body that is not from Xero", () => {
    expect(parseBudgetActuals({ ...ready, source: "outreach" })).toBeNull();
  });
});

describe("interpretActuals", () => {
  it("shows the schema gap and does not invent zeros", () => {
    const view = interpretActuals(503, {
      error: "Budget tables are not in the database yet. Hub Data applies them; actuals stay unread until then.",
      code: "schema_not_applied",
    });
    expect(view.kind).toBe("unavailable");
    if (view.kind === "unavailable") expect(view.message).toMatch(/not in the database/);
  });

  it("reads a successful Xero body", () => {
    const view = interpretActuals(200, ready);
    expect(view.kind).toBe("ready");
  });

  it("treats a missing route as unavailable", () => {
    const view = interpretActuals(404, { error: "Not found" });
    expect(view.kind).toBe("unavailable");
    if (view.kind === "unavailable") expect(view.message).toMatch(/not shown as zero|Nothing is shown as zero|aren't available/);
  });
});

describe("actual labels", () => {
  it("prints Unknown for null and a real zero for a coded line with no spend", () => {
    expect(actualAmountLabel(null, "ZAR")).toBe("Unknown");
    expect(actualAmountLabel(0, "ZAR")).toMatch(/0/);
    expect(actualAmountLabel(0, "ZAR")).not.toBe("Unknown");
  });

  it("withholds a total while any line is unknown", () => {
    expect(actualsTotalCents(ready.lines)).toBeNull();
    expect(actualsTotalCents([ready.lines[0]])).toBe(18000);
  });
});
