import { describe, expect, it } from "vitest";
import { renderDraftPdf } from "./draft-pdf";

describe("renderDraftPdf", () => {
  it("makes a PDF from a letter and a form, missing fields included", async () => {
    const pdf = await renderDraftPdf({
      title: "SARS tax compliance status request",
      kind: "form",
      body: "Request for a tax compliance status PIN.\n\nSecond paragraph.",
      fields: [
        { label: "Registered name", value: "Sample Organisation NPC", source: "NPO certificate", missing: false },
        { label: "Signatory ID number", value: "", source: "missing", missing: true },
      ],
      approvedBy: "Sample Owner",
      approvedOn: "18 November 2026",
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  }, 30000);
});
