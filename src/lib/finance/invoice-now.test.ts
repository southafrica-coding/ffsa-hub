import { describe, expect, it } from "vitest";
import { planInvoiceNow } from "./invoice-now";

const c = (id: string, status = "scheduled", plan_id = "p1") => ({ id, status, plan_id });
const opts = { today: "2027-02-01", key: "k" };

describe("planInvoiceNow", () => {
  it("re-dates each charge to today with its own invoice", () => {
    const r = planInvoiceNow([c("a"), c("b", "needs_decision")], { ...opts, together: false });
    expect(r.error).toBeNull();
    expect(r.updates).toEqual([
      { id: "a", status: "scheduled", scheduled_generation_date: "2027-02-01", combined_group_key: "NOW-k-a" },
      { id: "b", status: "scheduled", scheduled_generation_date: "2027-02-01", combined_group_key: "NOW-k-b" },
    ]);
  });

  it("ties charges into one invoice when sent together", () => {
    const r = planInvoiceNow([c("a"), c("b")], { ...opts, together: true });
    expect(new Set(r.updates.map((u) => u.combined_group_key))).toEqual(new Set(["NOW-k"]));
  });

  it("skips anything already invoiced, paid or cancelled", () => {
    const r = planInvoiceNow([c("a"), c("x", "sent"), c("y", "paid"), c("z", "cancelled")], { ...opts, together: false });
    expect(r.updates.map((u) => u.id)).toEqual(["a"]);
    expect(r.skipped).toEqual(["x", "y", "z"]);
    expect(planInvoiceNow([c("x", "sent")], { ...opts, together: false }).error).toMatch(/already invoiced/);
  });

  it("refuses to combine charges from different billing plans", () => {
    expect(planInvoiceNow([c("a", "scheduled", "p1"), c("b", "scheduled", "p2")], { ...opts, together: true }).error).toMatch(
      /different billing plans/
    );
  });
});
