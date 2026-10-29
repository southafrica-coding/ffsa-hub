import { describe, expect, it } from "vitest";
import type { FormField } from "@/lib/forms/schema";
import { validatePromoConfig } from "./promo-config";

const tiers = [
  {
    id: "general",
    questions: [
      { id: "age", type: "text", label: "Age", key: "age", required: true },
    ] as FormField[],
  },
  { id: "kids", questions: [] as FormField[] },
];

describe("promo code config validation", () => {
  it("accepts a percent code and normalises it", () => {
    const v = validatePromoConfig(
      { code: " early26 ", kind: "percent", percent_off: 15, amount_off_cents: 500 },
      tiers
    );
    expect(v).toMatchObject({
      ok: true,
      config: { code: "early26", kind: "percent", percent_off: 15, amount_off_cents: null, is_active: true },
    });
  });

  it("rejects bad discount shapes", () => {
    expect(validatePromoConfig({ code: "A", kind: "percent", percent_off: 0 }, tiers).ok).toBe(false);
    expect(validatePromoConfig({ code: "A", kind: "percent", percent_off: 101 }, tiers).ok).toBe(false);
    expect(validatePromoConfig({ code: "A", kind: "percent", percent_off: 12.5 }, tiers).ok).toBe(false);
    expect(validatePromoConfig({ code: "A", kind: "fixed_amount", amount_off_cents: 0 }, tiers).ok).toBe(false);
    expect(validatePromoConfig({ code: "A", kind: "bogus" }, tiers).ok).toBe(false);
    expect(validatePromoConfig({ code: "  ", kind: "comp" }, tiers).ok).toBe(false);
    expect(validatePromoConfig({ code: "TWO WORDS", kind: "comp" }, tiers).ok).toBe(false);
  });

  it("clears discount values a comp code doesn't use", () => {
    const v = validatePromoConfig({ code: "C", kind: "comp", percent_off: 40 }, tiers);
    expect(v).toMatchObject({ ok: true, config: { percent_off: null, amount_off_cents: null } });
  });

  it("checks the tier scope and validity window", () => {
    expect(validatePromoConfig({ code: "A", kind: "comp", applies_to_ticket_type_id: "other-event" }, tiers).ok).toBe(false);
    expect(
      validatePromoConfig(
        { code: "A", kind: "comp", valid_from: "2026-12-01T00:00:00Z", valid_until: "2026-11-01T00:00:00Z" },
        tiers
      ).ok
    ).toBe(false);
    expect(validatePromoConfig({ code: "A", kind: "comp", max_redemptions: 0 }, tiers).ok).toBe(false);
  });

  it("needs a waive-only code to waive something", () => {
    expect(validatePromoConfig({ code: "W", kind: "none" }, tiers).ok).toBe(false);
    expect(validatePromoConfig({ code: "W", kind: "none", waives_waiver: true }, tiers).ok).toBe(true);
    expect(
      validatePromoConfig(
        { code: "W", kind: "none", waived_questions: [{ ticket_type_id: "general", question_id: "age" }] },
        tiers
      ).ok
    ).toBe(true);
  });

  it("only allows waiving real questions inside the code's scope", () => {
    const ref = [{ ticket_type_id: "general", question_id: "age" }];
    expect(validatePromoConfig({ code: "W", kind: "none", waived_questions: [{ ticket_type_id: "general", question_id: "nope" }] }, tiers).ok).toBe(false);
    expect(validatePromoConfig({ code: "W", kind: "none", waived_questions: [{ ticket_type_id: "ghost", question_id: "age" }] }, tiers).ok).toBe(false);
    expect(validatePromoConfig({ code: "W", kind: "none", applies_to_ticket_type_id: "kids", waived_questions: ref }, tiers).ok).toBe(false);
    expect(validatePromoConfig({ code: "W", kind: "none", waived_questions: ["junk"] }, tiers).ok).toBe(false);
    expect(validatePromoConfig({ code: "W", kind: "none", applies_to_ticket_type_id: "general", waived_questions: ref }, tiers).ok).toBe(true);
  });
});
