import { describe, expect, it } from "vitest";
import { validateWaiverValues, type TierWaiver } from "./waivers";
import {
  WAIVER_BLOCK_MESSAGE,
  revealTargetId,
} from "./wild-ones-checkout-focus";

// Public Wild Ones Youth Camp tiers require a waiver but do not ask for
// the child's name or a relationship on that waiver. Those details are
// separate per-ticket questions. This locks that distinction.
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

describe("wild ones checkout focus", () => {
  it("moves ticket-question failures to the block under the waiver", () => {
    expect(revealTargetId("tickets")).toBe("wo-ticket-questions");
  });

  it("moves a waiver failure to the waiver, not the pay buttons", () => {
    expect(revealTargetId("waiver")).toBe("wo-waiver");
  });

  it("does not tell the buyer the form is below the pay buttons", () => {
    expect(WAIVER_BLOCK_MESSAGE.toLowerCase()).not.toContain("below");
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
