import { describe, expect, it } from "vitest";
import type { FormField } from "@/lib/forms/schema";
import {
  cartPromoDiscount,
  computeOrderWaivedSteps,
  computePromoDiscount,
  describeWaivedForCart,
  escapeLikePattern,
  promoUnavailableReason,
  questionsAfterPromo,
  ticketWaivedSteps,
  toPromoTerms,
  waivedQuestionIdsForTier,
  waiverAfterPromo,
  type PromoTerms,
} from "./promo-codes";
import { buildTicketAnswerGroups } from "./ticket-questions";
import { buildWaiverSignatureGroups, type TierWaiver } from "./waivers";

const GENERAL = "tier-general";
const KIDS = "tier-kids";

function q(id: string, extra: Partial<FormField> = {}): FormField {
  return { id, type: "text", label: `Q ${id}`, key: id, required: true, ...extra };
}

const WAIVER: TierWaiver = {
  enabled: true,
  version: "1",
  title: "Indemnity",
  body_markdown: "",
  document_path: "events/x/waiver.pdf",
  document_name: "waiver.pdf",
  require_minor_name: false,
  require_relationship: false,
};

function terms(over: Partial<PromoTerms> = {}): PromoTerms {
  return {
    code: "STAFF26",
    kind: "none",
    percent_off: null,
    amount_off_cents: null,
    applies_to_ticket_type_id: null,
    waives_waiver: false,
    waived_questions: [],
    ...over,
  };
}

const NOW = new Date("2026-10-26T10:00:00Z");
const AVAILABLE = {
  is_active: true,
  max_redemptions: null,
  redemption_count: 0,
  valid_from: null,
  valid_until: null,
};

describe("promo code discount math (integer cents)", () => {
  const cart = [
    { ticketTypeId: GENERAL, qty: 2, perTicketCents: 35000 },
    { ticketTypeId: KIDS, qty: 1, perTicketCents: 15000 },
  ];

  it("takes a percentage off every ticket for an any-tier code", () => {
    expect(computePromoDiscount(terms({ kind: "percent", percent_off: 10 }), cart)).toBe(8500);
  });

  it("only discounts the tier a restricted code applies to", () => {
    const t = terms({ kind: "percent", percent_off: 50, applies_to_ticket_type_id: KIDS });
    expect(computePromoDiscount(t, cart)).toBe(7500);
  });

  it("rounds percentages to whole cents", () => {
    const t = terms({ kind: "percent", percent_off: 33 });
    expect(computePromoDiscount(t, [{ ticketTypeId: GENERAL, qty: 1, perTicketCents: 999 }])).toBe(330);
  });

  it("caps a fixed amount at the in-scope tickets", () => {
    expect(computePromoDiscount(terms({ kind: "fixed_amount", amount_off_cents: 5000 }), cart)).toBe(5000);
    const big = terms({ kind: "fixed_amount", amount_off_cents: 999999, applies_to_ticket_type_id: KIDS });
    expect(computePromoDiscount(big, cart)).toBe(15000);
  });

  it("makes comp tickets free — whole order, or just the scoped tier", () => {
    expect(computePromoDiscount(terms({ kind: "comp" }), cart)).toBe(85000);
    expect(computePromoDiscount(terms({ kind: "comp", applies_to_ticket_type_id: GENERAL }), cart)).toBe(70000);
    expect(computePromoDiscount(terms({ kind: "percent", percent_off: 100 }), cart)).toBe(85000);
  });

  it("gives nothing off for a waive-only code, no code, or a tier not in the cart", () => {
    expect(computePromoDiscount(terms({ kind: "none", waives_waiver: true }), cart)).toBe(0);
    expect(computePromoDiscount(null, cart)).toBe(0);
    expect(
      computePromoDiscount(terms({ kind: "comp", applies_to_ticket_type_id: "other" }), cart)
    ).toBe(0);
  });

  it("prices the storefront cart the way checkout does (PWYW amount wins)", () => {
    const types = [
      { id: GENERAL, display_price_cents: 35000 },
      { id: KIDS, display_price_cents: 10000 },
    ];
    const t = terms({ kind: "percent", percent_off: 10 });
    expect(
      cartPromoDiscount(
        t,
        [
          { ticketTypeId: GENERAL, qty: 1, pwywAmountCents: null },
          { ticketTypeId: KIDS, qty: 1, pwywAmountCents: 20000 },
        ],
        types
      )
    ).toBe(5500);
  });
});

describe("promo code validation", () => {
  it("accepts a live code", () => {
    expect(promoUnavailableReason(AVAILABLE, NOW)).toBeNull();
  });

  it("rejects inactive, early, expired and used-up codes", () => {
    expect(promoUnavailableReason({ ...AVAILABLE, is_active: false }, NOW)).toMatch(/isn't valid/);
    expect(promoUnavailableReason({ ...AVAILABLE, valid_from: "2026-11-01T00:00:00Z" }, NOW)).toMatch(/isn't active yet/);
    expect(promoUnavailableReason({ ...AVAILABLE, valid_until: "2026-10-26T10:00:00Z" }, NOW)).toMatch(/expired/);
    expect(promoUnavailableReason({ ...AVAILABLE, max_redemptions: 3, redemption_count: 3 }, NOW)).toMatch(/fully redeemed/);
    expect(promoUnavailableReason({ ...AVAILABLE, max_redemptions: 3, redemption_count: 2 }, NOW)).toBeNull();
  });

  it("escapes LIKE wildcards so '%' can't match every code", () => {
    expect(escapeLikePattern("%")).toBe("\\%");
    expect(escapeLikePattern("STAFF_26")).toBe("STAFF\\_26");
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
    expect(escapeLikePattern("EARLY2026")).toBe("EARLY2026");
  });

  it("never lets an unknown kind discount", () => {
    const t = toPromoTerms({ code: "X", kind: "bogus", percent_off: 50 });
    expect(t.kind).toBe("none");
    expect(computePromoDiscount(t, [{ ticketTypeId: GENERAL, qty: 1, perTicketCents: 1000 }])).toBe(0);
  });

  it("drops malformed waived-question entries from a stored row", () => {
    const t = toPromoTerms({
      code: "X",
      kind: "none",
      waived_questions: [
        { ticket_type_id: GENERAL, question_id: "a" },
        { ticket_type_id: GENERAL, question_id: "a" },
        { question_id: "b" },
        "junk",
      ],
    });
    expect(t.waived_questions).toEqual([{ ticket_type_id: GENERAL, question_id: "a" }]);
  });
});

describe("waived waiver", () => {
  it("drops the waiver only for tiers in the code's scope", () => {
    const anyTier = terms({ waives_waiver: true });
    expect(waiverAfterPromo(WAIVER, anyTier, GENERAL)).toBeNull();
    const kidsOnly = terms({ waives_waiver: true, applies_to_ticket_type_id: KIDS });
    expect(waiverAfterPromo(WAIVER, kidsOnly, GENERAL)).toBe(WAIVER);
    expect(waiverAfterPromo(WAIVER, kidsOnly, KIDS)).toBeNull();
    expect(waiverAfterPromo(WAIVER, terms({ kind: "comp" }), GENERAL)).toBe(WAIVER);
    expect(waiverAfterPromo(WAIVER, null, GENERAL)).toBe(WAIVER);
  });

  it("lets checkout through with no signatures when the code waives it", () => {
    const resolved = (t: PromoTerms | null) => [
      { ticketTypeId: GENERAL, qty: 2, waiver: waiverAfterPromo(WAIVER, t, GENERAL) },
    ];
    const meta = { signedAt: NOW.toISOString(), ip: null };
    expect(buildWaiverSignatureGroups(resolved(null), [], meta).valid).toBe(false);
    const waived = buildWaiverSignatureGroups(resolved(terms({ waives_waiver: true })), [], meta);
    expect(waived).toEqual({ valid: true, groups: [] });
  });

  it("ignores signatures a client sends for a waived tier", () => {
    const res = buildWaiverSignatureGroups(
      [{ ticketTypeId: GENERAL, qty: 1, waiver: waiverAfterPromo(WAIVER, terms({ waives_waiver: true }), GENERAL) }],
      [{ ticket_type_id: GENERAL, values: { guardian_name: "A", typed_signature: "A", agreed: true } }],
      { signedAt: NOW.toISOString(), ip: null }
    );
    expect(res.groups).toEqual([]);
  });
});

describe("waived per-ticket questions", () => {
  const questions = [
    q("name"),
    q("age"),
    q("allergies", { type: "yes_no" }),
    q("allergy-detail", { parentFieldId: "allergies", showWhenValue: "Yes" }),
    q("church", { required: false }),
  ];

  it("removes only the picked questions for the picked tier", () => {
    const t = terms({ waived_questions: [{ ticket_type_id: GENERAL, question_id: "age" }] });
    expect(questionsAfterPromo(questions, t, GENERAL).map((x) => x.id)).toEqual([
      "name",
      "allergies",
      "allergy-detail",
      "church",
    ]);
    // Same question id on another tier is untouched.
    expect(questionsAfterPromo(questions, t, KIDS)).toBe(questions);
  });

  it("takes a skipped question's follow-ups with it", () => {
    const t = terms({ waived_questions: [{ ticket_type_id: GENERAL, question_id: "allergies" }] });
    expect(waivedQuestionIdsForTier(questions, t, GENERAL)).toEqual(["allergies", "allergy-detail"]);
  });

  it("respects the code's tier scope", () => {
    const t = terms({
      applies_to_ticket_type_id: KIDS,
      waived_questions: [{ ticket_type_id: GENERAL, question_id: "age" }],
    });
    expect(waivedQuestionIdsForTier(questions, t, GENERAL)).toEqual([]);
  });

  it("doesn't fail required-field validation for waived questions, but still enforces the rest", () => {
    const t = terms({
      waived_questions: [
        { ticket_type_id: GENERAL, question_id: "age" },
        { ticket_type_id: GENERAL, question_id: "allergies" },
      ],
    });
    const lines = (answers: Record<string, unknown>) =>
      buildTicketAnswerGroups(
        [{ ticketTypeId: GENERAL, qty: 1, questions: questionsAfterPromo(questions, t, GENERAL) }],
        [{ ticket_type_id: GENERAL, answers }]
      );
    const ok = lines({ name: "Thandi", age: "should be dropped" });
    expect(ok.valid).toBe(true);
    expect(ok.groups[0].answers.map((a) => a.id)).toEqual(["name"]);
    expect(lines({}).valid).toBe(false);
  });

  it("can waive every question on a tier", () => {
    const t = terms({
      waived_questions: questions.map((x) => ({ ticket_type_id: GENERAL, question_id: x.id })),
    });
    const res = buildTicketAnswerGroups(
      [{ ticketTypeId: GENERAL, qty: 3, questions: questionsAfterPromo(questions, t, GENERAL) }],
      []
    );
    expect(res).toEqual({ valid: true, groups: [] });
  });
});

describe("recording waived steps", () => {
  const tiers = [
    { ticketTypeId: GENERAL, questions: [q("name"), q("age")], waiverActive: true },
    { ticketTypeId: KIDS, questions: [q("name")], waiverActive: false },
  ];

  it("records per tier only what the tier really had", () => {
    const t = terms({
      waives_waiver: true,
      waived_questions: [
        { ticket_type_id: GENERAL, question_id: "age" },
        { ticket_type_id: GENERAL, question_id: "gone" },
      ],
    });
    expect(computeOrderWaivedSteps(t, tiers)).toEqual([
      { ticket_type_id: GENERAL, waiver: true, question_ids: ["age"] },
    ]);
    expect(computeOrderWaivedSteps(null, tiers)).toEqual([]);
    expect(computeOrderWaivedSteps(terms({ kind: "comp" }), tiers)).toEqual([]);
  });

  it("stamps each ticket with the code and its tier's waived steps", () => {
    const steps = [{ ticket_type_id: GENERAL, waiver: true, question_ids: ["age"] }];
    expect(ticketWaivedSteps(steps, "STAFF26", GENERAL)).toEqual({
      promo_code: "STAFF26",
      waiver: true,
      question_ids: ["age"],
    });
    expect(ticketWaivedSteps(steps, "STAFF26", KIDS)).toBeNull();
    expect(ticketWaivedSteps(steps, null, GENERAL)).toBeNull();
    expect(ticketWaivedSteps([], "STAFF26", GENERAL)).toBeNull();
  });

  it("describes what the code skips for the buyer", () => {
    const types = [
      { id: GENERAL, questions: [q("name"), q("age")], waiver: WAIVER },
      { id: KIDS, questions: [], waiver: null },
    ];
    const t = terms({
      waives_waiver: true,
      waived_questions: [{ ticket_type_id: GENERAL, question_id: "age" }],
    });
    expect(describeWaivedForCart(t, [{ ticketTypeId: GENERAL }], types)).toBe(
      "Skips the waiver and 1 question"
    );
    expect(describeWaivedForCart(t, [{ ticketTypeId: KIDS }], types)).toBeNull();
    expect(describeWaivedForCart(null, [{ ticketTypeId: GENERAL }], types)).toBeNull();
  });
});
