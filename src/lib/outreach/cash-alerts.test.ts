import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/slack/client", () => ({}));

import { alertText } from "./cash-alerts";

describe("alertText", () => {
  const base = { team: "Botswana", sent: 20000, teamId: "t1" };
  it("running low: what's left, of what, how long, and a link", () => {
    const t = alertText({ ...base, level: "low", left: 4800, pctLeft: 24, days: 4 });
    expect(t).toContain("🟠 *Botswana* has *R4 800* left of the R20 000 sent (24%) — about 4 days at this week's spending.");
    expect(t).toContain("Time to plan the next transfer.");
    expect(t).toContain("/finance/outreach/t1|Open the team>");
  });
  it("urgent", () => {
    expect(alertText({ ...base, level: "critical", left: 2100, pctLeft: 10.5, days: null })).toMatch(
      /^🔴 \*Botswana\* has only \*R2 100\* left of the R20 000 sent \(11%\)\.\nPlease send money now\./
    );
  });
  it("overspent", () => {
    expect(alertText({ ...base, level: "critical", left: -350, pctLeft: -1.75, days: 0 })).toMatch(
      /has spent R350 more than was sent/
    );
  });
});
