import { describe, it, expect } from "vitest";
import {
  fillPlaceholders,
  statementEmail,
  statementFileName,
  unknownPlaceholders,
  wordingOf,
  DEFAULT_WORDING,
  type WordingSettings,
} from "./donor-statement-wording";

const settings: WordingSettings = {
  org_name: "FF SA USA, INC",
  tax_id: "99-1356564",
  address_line1: "C/O FF CHARLOTTE",
  address_line2: "1324 THE PLAZA",
  address_city_line: "CHARLOTTE, NC 28205-3428",
  signer_name: "Sample Person 3",
  signer_title: "President",
};

describe("donor statement wording", () => {
  it("fills every placeholder, case-insensitively", () => {
    const out = fillPlaceholders("[donor name] · [Year] · $[Total] · [Tax ID] · [Address]", settings, {
      donorName: "Sample Q Person 913",
      year: 2026,
      totalCents: 150000,
    });
    expect(out).toBe("Sample Q Person 913 · 2026 · $1,500.00 · 99-1356564 · C/O FF CHARLOTTE\n1324 THE PLAZA\nCHARLOTTE, NC 28205-3428");
  });

  it("writes the email Sample Person 50 specified, with the fixed subject spelling", () => {
    const e = statementEmail(settings, { name: "Sample Person 910", totalCents: 150000 }, 2026);
    expect(e.subject).toBe("2026 Giving Statement - Thank You for Your Generosity!");
    expect(e.text.startsWith("Dear Sample Person 910,\n\nOn behalf of FF SA USA, INC, we want")).toBe(true);
    expect(e.text).toContain("Your total donation for 2026 is: $1,500.00.");
    expect(e.text).toContain("(EIN: 99-1356564)");
    expect(e.text.endsWith("Sample Person 3\nPresident\nFF SA USA, INC\nC/O FF CHARLOTTE\n1324 THE PLAZA\nCHARLOTTE, NC 28205-3428")).toBe(true);
    expect(e.text).not.toMatch(/\[|Kailua|Kona|Hawaii|HI 96/);
    expect(e.html).toContain("Dear Sample Person 910,");
    expect(e.html).toContain("Sample Person 3<br>President");
  });

  it("escapes donor names in the html", () => {
    const e = statementEmail(settings, { name: "A <b>Tag</b> & Co", totalCents: 100 }, 2026);
    expect(e.html).toContain("A &lt;b&gt;Tag&lt;/b&gt; &amp; Co");
  });

  it("falls back to the default wording when a field is blank or missing", () => {
    expect(wordingOf({ ...settings, irs_paragraph: "  " }).irs).toBe(DEFAULT_WORDING.irs_paragraph);
    expect(wordingOf(settings).irs).toBe(
      "This letter serves as a record of your charitable contributions. No goods or services were provided in exchange for these donations. Your donations are tax-deductible to the extent allowed by law."
    );
  });

  it("names the PDF as specified and keeps it file-safe", () => {
    expect(statementFileName(2026, "Sample Q Person 913")).toBe("FF SA USA - 2026 Donation Statement - Sample Q Person 913.pdf");
    expect(statementFileName(2026, "Sample / School: 919")).toBe("FF SA USA - 2026 Donation Statement - Sample School 919.pdf");
  });

  it("spots placeholders it doesn't know", () => {
    expect(unknownPlaceholders("Hi [Donor Name], [First Name] gave $[total] [Amount]")).toEqual(["[First Name]", "[Amount]"]);
    expect(unknownPlaceholders(DEFAULT_WORDING.email_body)).toEqual([]);
  });
});
