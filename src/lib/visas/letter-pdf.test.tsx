import React from "react";
import { describe, expect, it } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { VisaLetterDocument } from "./letter-pdf";
import { SIGNATURE_MARK, fillPassport } from "./letters";

// Made-up wording; the real letters live only in the Hub's database.
const TEXT = [
  "24 November 2026",
  "Dear Sir or Madam",
  "Sample Student, passport {{passport_number}}, is invited to a school.",
  "FFSA takes responsibility for her repatriation.",
  SIGNATURE_MARK,
  "Legal officer\nFire and Fragrance South Africa",
].join("\n\n");

describe("VisaLetterDocument", () => {
  it("renders a PDF, with and without the checking band", async () => {
    for (const forChecking of [false, true]) {
      const doc = React.createElement(VisaLetterDocument, {
        text: fillPassport(TEXT, "XT0000000"),
        reference: "ABCD1234",
        forChecking,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdf = await renderToBuffer(doc as any);
      expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe("%PDF-");
      if (process.env.VISA_LETTER_PDF_OUT) {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(`${process.env.VISA_LETTER_PDF_OUT}-${forChecking ? "check" : "print"}.pdf`, pdf);
      }
    }
  }, 30_000);
});
