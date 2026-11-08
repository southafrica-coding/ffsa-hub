import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FormField } from "@/lib/forms/schema";
import type { BuyerFieldConfig } from "@/lib/ticketing/buyer-fields";
import type { TicketQuestionSlot } from "@/lib/ticketing/ticket-questions";
import {
  validateWaiverValues,
  type TierWaiver,
  type WaiverSlot,
  type WaiverSlotValues,
} from "@/lib/ticketing/waivers";
import {
  PAY_SUMMARY_TITLE,
  checkoutPostsFor,
  planWildOnesCheckout,
  revealTargetId,
  type WildOnesPayInput,
} from "./wild-ones-checkout-focus";

const youthCampWaiver: TierWaiver = {
  enabled: true,
  version: "1",
  title: "Waiver & Indemnity Form",
  body_markdown: "",
  document_path: "blank/synthetic/waiver.pdf",
  document_name: "synthetic-waiver.pdf",
  require_minor_name: false,
  require_relationship: false,
};

const buyerFields: BuyerFieldConfig[] = [
  { key: "first_name", enabled: false, required: false },
  { key: "last_name", enabled: false, required: false },
  { key: "email", enabled: true, required: true },
  { key: "phone", enabled: false, required: false },
  { key: "marketing_consent", enabled: true, required: false },
];

const parentQuestions: FormField[] = [
  { id: "cq_name", key: "", type: "text", label: "Parent/Guardian's Full Name", required: true },
  { id: "cq_number", key: "", type: "number", label: "Parent/Guardian's Number", required: true },
  { id: "cq_id", key: "", type: "text", label: "Parent/Guardian's ID/Passport no.", required: true },
  { id: "cq_addr", key: "", type: "text", label: "Residential Address", required: true },
];

const childQuestions: FormField[] = [
  { id: "tq_child", key: "", type: "text", label: "Child's Full Name", required: true },
  { id: "tq_dob", key: "", type: "date", label: "Child's Date of Birth", required: true },
];

const SLOT = "synthetic-early:0";

function waiverSlot(waiver: TierWaiver = youthCampWaiver): WaiverSlot {
  return {
    key: SLOT,
    ticketTypeId: "synthetic-early",
    ticketTypeName: "Early Bird Ticket",
    index: 0,
    waiver,
  };
}

function ticketSlot(): TicketQuestionSlot {
  return {
    key: SLOT,
    ticketTypeId: "synthetic-early",
    ticketTypeName: "Early Bird Ticket",
    index: 0,
    questions: childQuestions,
  };
}

const signed: WaiverSlotValues = {
  guardian_name: "Alex Example",
  typed_signature: "Alex Example",
  agreed: true,
};

function ready(overrides: Partial<WildOnesPayInput> = {}): WildOnesPayInput {
  return {
    lineCount: 1,
    buyerFields,
    firstName: "",
    lastName: "",
    email: "camper.parent@example.com",
    phone: "",
    checkoutQuestions: parentQuestions,
    customAnswers: {
      cq_name: "Alex Example",
      cq_number: "825550100",
      cq_id: "A00000000",
      cq_addr: "1 Example Road",
    },
    ticketSlots: [ticketSlot()],
    ticketAnswers: {
      [SLOT]: { tq_child: "Sam Example", tq_dob: "2012-06-15" },
    },
    waiverSlots: [waiverSlot()],
    waiverValues: { [SLOT]: signed },
    termsAccepted: true,
    ...overrides,
  };
}

function texts(input: WildOnesPayInput): string[] {
  return planWildOnesCheckout(input).items.map((item) => item.text);
}

function posts(input: WildOnesPayInput): number {
  return checkoutPostsFor(planWildOnesCheckout(input));
}

describe("wild ones checkout focus", () => {
  it("moves ticket-question failures to the block under the waiver", () => {
    expect(revealTargetId("tickets")).toBe("wo-ticket-questions");
  });

  it("moves a waiver failure to the waiver, not the pay buttons", () => {
    expect(revealTargetId("waiver")).toBe("wo-waiver");
  });

  it("names the summary without pointing below the pay buttons", () => {
    expect(PAY_SUMMARY_TITLE.toLowerCase()).not.toContain("below");
  });
});

describe("youth-camp waiver shape", () => {
  it("accepts a matching signature and consent without a child name", () => {
    const result = validateWaiverValues(youthCampWaiver, {
      guardian_name: "Alex Example",
      typed_signature: "alex example",
      agreed: true,
    });
    expect(result.valid).toBe(true);
  });

  it("still rejects a signature that does not match the guardian name", () => {
    const result = validateWaiverValues(youthCampWaiver, {
      guardian_name: "Alex Example",
      typed_signature: "A Example",
      agreed: true,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.typed_signature).toMatch(/match/i);
  });

  it("still requires the guardian agreement", () => {
    const result = validateWaiverValues(youthCampWaiver, {
      guardian_name: "Alex Example",
      typed_signature: "Alex Example",
      agreed: false,
    });
    expect(result.errors.agreed).toBeTruthy();
  });
});

describe("pay attempt gates", () => {
  it("allows a complete form to post once", () => {
    const plan = planWildOnesCheckout(ready());
    expect(plan.action).toBe("post");
    expect(plan.items).toEqual([]);
    expect(posts(ready())).toBe(1);
  });

  it("blocks a missing email and does not post", () => {
    const plan = planWildOnesCheckout(ready({ email: "  " }));
    expect(plan.action).toBe("block");
    expect(texts(ready({ email: "" }))).toContain("Add an email address");
    expect(posts(ready({ email: "" }))).toBe(0);
  });

  it("blocks an invalid email without repeating it", () => {
    const secret = "not-valid-secret.person";
    const plan = planWildOnesCheckout(ready({ email: secret }));
    expect(plan.items.map((item) => item.text)).toContain("Enter a valid email address");
    expect(JSON.stringify(plan.items)).not.toContain(secret);
    expect(posts(ready({ email: secret }))).toBe(0);
  });

  it("blocks a missing parent checkout question", () => {
    const plan = planWildOnesCheckout(
      ready({
        customAnswers: {
          cq_name: "Alex Example",
          cq_number: "825550100",
          cq_id: "",
          cq_addr: "1 Example Road",
        },
      })
    );
    expect(plan.items.map((item) => item.fieldId)).toContain("cq-cq_id");
    expect(plan.items.map((item) => item.text).join(" ")).toContain(
      "Parent/Guardian's ID/Passport no."
    );
    expect(posts(ready({ customAnswers: { cq_name: "Alex Example" } }))).toBe(0);
  });

  it("blocks a missing child question even when the waiver is signed", () => {
    const plan = planWildOnesCheckout(
      ready({ ticketAnswers: { [SLOT]: { tq_child: "", tq_dob: "2012-06-15" } } })
    );
    expect(plan.items.map((item) => item.text).join(" ")).toContain("Child's Full Name");
    expect(plan.items.map((item) => item.text).join(" ")).toContain("Early Bird Ticket, ticket 1");
    expect(plan.action).toBe("block");
    expect(checkoutPostsFor(plan)).toBe(0);
  });

  it("blocks a missing guardian name", () => {
    const plan = planWildOnesCheckout(
      ready({
        waiverValues: {
          [SLOT]: { typed_signature: "Alex Example", agreed: true },
        },
      })
    );
    expect(plan.items.map((item) => item.text).join(" ")).toContain(
      "parent or guardian's full name"
    );
    expect(checkoutPostsFor(plan)).toBe(0);
  });

  it("blocks a mismatched signature without quoting either name", () => {
    const secret = "SECRET-GUARDIAN-77";
    const plan = planWildOnesCheckout(
      ready({
        waiverValues: {
          [SLOT]: {
            guardian_name: secret,
            typed_signature: "Someone Else",
            agreed: true,
          },
        },
      })
    );
    const joined = plan.items.map((item) => item.text).join(" ");
    expect(joined).toContain("signature that matches the parent or guardian name");
    expect(JSON.stringify(plan.items)).not.toContain(secret);
    expect(JSON.stringify(plan.items)).not.toContain("Someone Else");
    expect(checkoutPostsFor(plan)).toBe(0);
  });

  it("blocks unticked parent or guardian consent", () => {
    const plan = planWildOnesCheckout(
      ready({
        waiverValues: {
          [SLOT]: { ...signed, agreed: false },
        },
      })
    );
    expect(plan.items.map((item) => item.text).join(" ")).toContain(
      "Tick the parent or guardian consent"
    );
    expect(plan.items.map((item) => item.fieldId).join(" ")).toContain("agreed");
    expect(checkoutPostsFor(plan)).toBe(0);
  });

  it("blocks the Ticket Purchase Terms on their own", () => {
    const plan = planWildOnesCheckout(ready({ termsAccepted: false }));
    expect(plan.items).toEqual([
      {
        fieldId: "wo-terms",
        text: "Tick the Ticket Purchase Terms & Consent Agreement",
      },
    ]);
    expect(checkoutPostsFor(plan)).toBe(0);
  });

  it("lists terms, guardian consent, the signature, and the child question together", () => {
    const plan = planWildOnesCheckout(
      ready({
        termsAccepted: false,
        waiverValues: {
          [SLOT]: {
            guardian_name: "Alex Example",
            typed_signature: "A Example",
            agreed: false,
          },
        },
        ticketAnswers: { [SLOT]: { tq_child: "", tq_dob: "" } },
      })
    );
    const joined = plan.items.map((item) => item.text).join(" | ");
    expect(joined).toContain("signature that matches");
    expect(joined).toContain("parent or guardian consent");
    expect(joined).toContain("Child's Full Name");
    expect(joined).toContain("Child's Date of Birth");
    expect(joined).toContain("Ticket Purchase Terms");
    expect(plan.items[0].fieldId).toBe(`wo-w-${SLOT}-signature`);
    expect(checkoutPostsFor(plan)).toBe(0);
  });

  it("still requires an attendee name when the waiver asks for one", () => {
    const strict: TierWaiver = { ...youthCampWaiver, require_minor_name: true };
    const plan = planWildOnesCheckout(
      ready({
        waiverSlots: [waiverSlot(strict)],
        waiverValues: { [SLOT]: signed },
      })
    );
    expect(plan.items.map((item) => item.text).join(" ")).toContain("attendee's full name");
    expect(checkoutPostsFor(plan)).toBe(0);
  });

  it("does not ask for an attendee name when the waiver does not", () => {
    const plan = planWildOnesCheckout(ready());
    expect(plan.items.map((item) => item.text).join(" ")).not.toContain("attendee's full name");
  });

  it("blocks a pay-later attempt with no country and posts when one is chosen", () => {
    expect(checkoutPostsFor(planWildOnesCheckout(ready({ invoiceCountry: "" })))).toBe(0);
    expect(texts(ready({ invoiceCountry: " " }))).toContain("Choose a country for the invoice");
    expect(checkoutPostsFor(planWildOnesCheckout(ready({ invoiceCountry: "South Africa" })))).toBe(1);
  });

  it("makes no checkout post for every invalid gate", () => {
    const gates: WildOnesPayInput[] = [
      ready({ lineCount: 0 }),
      ready({ email: "" }),
      ready({ email: "missing-at-sign" }),
      ready({ customAnswers: { cq_name: "", cq_number: "1", cq_id: "A", cq_addr: "Road" } }),
      ready({ customAnswers: { ...ready().customAnswers, cq_number: "12abc" } }),
      ready({ ticketAnswers: { [SLOT]: { tq_child: "Sam Example", tq_dob: "" } } }),
      ready({ waiverValues: { [SLOT]: { agreed: true } } }),
      ready({
        waiverValues: {
          [SLOT]: { guardian_name: "Alex Example", typed_signature: "Nope", agreed: true },
        },
      }),
      ready({ waiverValues: { [SLOT]: { ...signed, agreed: false } } }),
      ready({ termsAccepted: false }),
      ready({ invoiceCountry: "" }),
    ];
    for (const gate of gates) {
      expect(checkoutPostsFor(planWildOnesCheckout(gate))).toBe(0);
    }
  });

  it("leaves the entered answers untouched", () => {
    const input = ready({
      customAnswers: { ...ready().customAnswers, cq_id: "SECRET-ID-88" },
      ticketAnswers: { [SLOT]: { tq_child: "", tq_dob: "2012-06-15" } },
    });
    const answers = input.customAnswers;
    planWildOnesCheckout(input);
    expect(input.customAnswers).toBe(answers);
    expect(input.customAnswers.cq_id).toBe("SECRET-ID-88");
    expect(JSON.stringify(planWildOnesCheckout(input).items)).not.toContain("SECRET-ID-88");
  });
});

describe("payment controls stay clickable until a request is in flight", () => {
  const src = readFileSync(
    new URL("../../app/(public)/e/[slug]/wild-ones-storefront.tsx", import.meta.url),
    "utf8"
  );

  it("does not disable PAY or CHECKOUT for a missing field or unticked terms", () => {
    expect(src).not.toMatch(/disabled=\{[^}]*!buyerValid/);
    expect(src).not.toMatch(/disabled=\{[^}]*!consentAccepted/);
    expect(src).not.toMatch(/disabled=\{[^}]*!invoiceCountry/);
    expect(src).toContain("disabled={submitting !== null}");
  });

  it("does not put a native required attribute on the terms checkbox", () => {
    const at = src.indexOf('id="wo-terms"');
    expect(at).toBeGreaterThan(-1);
    const snippet = src.slice(at, at + 280);
    expect(snippet).not.toMatch(/\srequired(?:[\s=>/{]|$)/);
    expect(snippet).toContain('aria-required="true"');
  });

  it("posts only after the plan allows it", () => {
    const submit = src.slice(src.indexOf("async function submit"), src.indexOf("const dateRange"));
    const guard = submit.indexOf('plan.action !== "post"');
    const fetchAt = submit.indexOf("fetch(");
    expect(guard).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(guard);
  });
});
