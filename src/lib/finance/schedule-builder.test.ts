import { describe, it, expect } from "vitest";
import {
  buildSchedule,
  resolveHeldCharge,
  type BuilderChargeItem,
  type BuilderContext,
} from "./schedule-builder";

/**
 * The generation guard (docs/redesign/07-finance-billing.md §4).
 *
 * The two cases the handoff names by hand, because they are the ones most
 * likely to be built as a crash: a student accepted four months into a
 * year-long school, and one accepted eleven days before it starts.
 *
 * What must never happen, in either case:
 *   · an invoice dated in the past
 *   · a charge silently skipped
 *   · a due date silently shifted to make the problem go away
 */

// NOTE: these are typed, not cast. An earlier version cast them with
// `as unknown as`, which hid a missing `cadence` and produced an empty
// schedule that looked like a guard bug.

// Monthly tuition for 10 months, invoiced on the 15th of the preceding month.
const tuition: BuilderChargeItem = {
  id: "tuition",
  label: "Tuition",
  charge_type: "monthly_tuition",
  amount_zar: 5000,
  xero_item_code: "TUI-A",
  cadence: "monthly",
  quantity: 10,
  due_anchor: "month_day",
  due_day: 1,
  first_due_month: 1,
  first_due_year: 2027,
  fixed_due_date: null,
  arrival_offset_days: null,
  generation_rule: "preceding_month_15th",
  generation_fixed_date: null,
  generation_lead_days: null,
  sort_order: 1,
};

// A deposit due on acceptance, invoiced immediately.
const deposit: BuilderChargeItem = {
  id: "deposit",
  label: "Deposit",
  charge_type: "deposit",
  amount_zar: 3000,
  xero_item_code: "DEP-A",
  cadence: "once",
  quantity: 1,
  due_anchor: "acceptance",
  due_day: null,
  first_due_month: null,
  first_due_year: null,
  fixed_due_date: null,
  arrival_offset_days: null,
  generation_rule: "immediate",
  generation_fixed_date: null,
  generation_lead_days: null,
  sort_order: 0,
};

const base: BuilderContext = {
  acceptanceDate: "2026-11-01",
  paymentPreference: "standard",
  groupYear: 2027,
};

describe("generation guard", () => {
  it("marks charges whose window closed, and never dates one in the past", () => {
    // Accepted 1 May 2027 — four months into a school that began in January.
    const { rows, needsDecisionCount } = buildSchedule([deposit, tuition], {
      ...base,
      acceptanceDate: "2027-05-01",
      today: "2027-05-01",
    });

    expect(needsDecisionCount).toBeGreaterThan(0);

    // Nothing is quietly dropped: the full schedule is still there.
    expect(rows.length).toBe(11); // deposit + 10 months

    // Every row whose generation date has passed is held for a decision, and
    // NOTHING is left in a state that would generate with a past date.
    for (const r of rows) {
      if (r.scheduled_generation_date <= "2027-05-01") {
        expect(r.status).toBe("needs_decision");
      } else {
        expect(r.status).toBe("scheduled");
      }
    }

    // Due dates are untouched — the guard holds charges, it does not re-date them.
    const january = rows.find((r) => r.due_date === "2027-01-01");
    expect(january).toBeDefined();
    expect(january!.status).toBe("needs_decision");
  });

  it("leaves an on-time acceptance entirely alone", () => {
    // Accepted 21 December 2026, eleven days before a 1 January start. The
    // first generation date (15 Dec) has passed; the rest have not.
    const { rows, needsDecisionCount } = buildSchedule([tuition], {
      ...base,
      acceptanceDate: "2026-12-21",
      today: "2026-12-21",
    });

    // Only the already-past January generation is held.
    expect(needsDecisionCount).toBe(1);
    expect(rows.filter((r) => r.status === "scheduled").length).toBe(9);
  });

  it("treats everything before a school's Hub start date as history", () => {
    // Partial adoption: the Hub takes over from 1 June 2027.
    const { rows, warnings } = buildSchedule([tuition], {
      ...base,
      acceptanceDate: "2027-05-01",
      today: "2027-05-01",
      scheduleStartDate: "2027-06-01",
    });

    // Nothing due before go-live is rebuilt as a chargeable row.
    expect(rows.every((r) => r.due_date >= "2027-06-01")).toBe(true);
    expect(warnings.join(" ")).toMatch(/opening balance/i);
  });

  it("does not hold anything when she is accepted before any window opens", () => {
    const { rows, needsDecisionCount } = buildSchedule([tuition], {
      ...base,
      acceptanceDate: "2026-06-01",
      today: "2026-06-01",
    });

    expect(needsDecisionCount).toBe(0);
    expect(rows.every((r) => r.status === "scheduled")).toBe(true);
  });
});

describe("resolving a held charge", () => {
  const TODAY = "2027-05-01";

  it("never sets a generation date in the past", () => {
    for (const outcome of ["catch_up_single", "issue_separately"] as const) {
      const patch = resolveHeldCharge(outcome, TODAY, "k");
      expect(patch.scheduled_generation_date).toBe(TODAY);
      expect(patch.scheduled_generation_date! < TODAY).toBe(false);
      expect(patch.status).toBe("scheduled");
    }
  });

  it("groups a catch-up into one invoice and issues the rest separately", () => {
    expect(resolveHeldCharge("catch_up_single", TODAY, "k").combined_group_key).toBe("k");
    expect(resolveHeldCharge("issue_separately", TODAY, "k").combined_group_key).toBeNull();
  });

  it("drops rather than deletes when starting from now", () => {
    const patch = resolveHeldCharge("start_from_now", TODAY, "k");
    expect(patch.status).toBe("cancelled");
    // No generation date at all — nothing will ever be created for it.
    expect(patch.scheduled_generation_date).toBeUndefined();
  });
});
