import { describe, it, expect } from "vitest";
import {
  buildStatements,
  parseAmount,
  fixEncoding,
  donorKey,
  ministryFor,
  formatUsDate,
  parseXeroReport,
  parseDonationsList,
  parseWorkbook,
  parseDateCell,
  matchCreditNoteDonor,
  planSends,
  type SourceLine,
} from "./donor-statements";

const line = (o: Partial<SourceLine> & Pick<SourceLine, "invoiceNumber" | "contactName" | "unitPriceUsd">): SourceLine => ({
  invoiceDate: "2026-03-04",
  quantity: 1,
  currency: "USD",
  status: "PAID",
  description: "Donation",
  ...o,
});

describe("small rules", () => {
  it("reads amounts typed as text", () => {
    expect(parseAmount("$1,000")).toBe(1000);
    expect(parseAmount("$1,500.00")).toBe(1500);
    expect(parseAmount(" 13.47 ")).toBe(13.47);
    expect(parseAmount("(50.00)")).toBe(-50);
    expect(parseAmount("-$5")).toBe(-5);
    expect(parseAmount(250)).toBe(250);
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });

  it("repairs mojibake names and leaves good ones alone", () => {
    expect(fixEncoding("SamplÃ© Person 902")).toBe("Samplé Person 902");
    expect(fixEncoding("PersonÃ© Sample 903")).toBe("Personé Sample 903");
    expect(fixEncoding("Samplé Person 904")).toBe("Samplé Person 904");
    expect(fixEncoding("Plain Name")).toBe("Plain Name");
  });

  it("groups names regardless of case, accents and spacing", () => {
    expect(donorKey("  Samplé  Person 902 ")).toBe(donorKey("SamplÃ© Person 902"));
    expect(donorKey("SAMPLE Q PERSON 913")).toBe("sample q person 913");
  });

  it("assigns ministry from the description", () => {
    expect(ministryFor("Missio Church - Tithe")).toBe("Missio Church");
    expect(ministryFor("HULC Donation")).toBe("Fire & Fragrance South Africa");
    expect(ministryFor(null)).toBe("Fire & Fragrance South Africa");
  });

  it("prints dates as MM-DD-YYYY", () => {
    expect(formatUsDate("2026-01-02")).toBe("01-02-2026");
  });

  it("reads Excel serials and US dates", () => {
    expect(parseDateCell(46024)).toBe("2026-01-02");
    expect(parseDateCell("1/2/2026")).toBe("2026-01-02");
    expect(parseDateCell("2026-10-05")).toBe("2026-10-05");
  });
});

describe("buildStatements", () => {
  it("combines invoice lines into one gift using Unit Price × Quantity, not Invoice Total", () => {
    const r = buildStatements({
      taxYear: 2026,
      lines: [
        line({ invoiceNumber: "INV-2223", contactName: "Sample Person 910", unitPriceUsd: 1000, description: "HULC Donation", invoiceTotalUsd: 1406.7 }),
        line({ invoiceNumber: "INV-2223", contactName: "Sample Person 910", unitPriceUsd: 500, description: "Donation", invoiceTotalUsd: 1406.7 }),
        line({ invoiceNumber: "INV-2223", contactName: "Sample Person 910", unitPriceUsd: -93.3, itemCode: "STRIPE", description: "Stripe Card Processing Fee", invoiceTotalUsd: 1406.7 }),
      ],
    });
    expect(r.donors).toHaveLength(1);
    expect(r.donors[0].gifts).toHaveLength(1);
    expect(r.donors[0].totalCents).toBe(150000);
    expect(r.donors[0].gifts[0].netCents).toBe(140670);
    expect(r.excludedLines).toHaveLength(1);
    expect(r.excludedLines[0].reason).toMatch(/STRIPE/);
  });

  it("uses the net amount when the run asks for it", () => {
    const r = buildStatements({
      taxYear: 2026,
      options: { amountBasis: "net" },
      lines: [line({ invoiceNumber: "INV-1", contactName: "Sample Person 910", unitPriceUsd: 1500, invoiceTotalUsd: 1406.7 })],
    });
    expect(r.totals.grandTotalCents).toBe(140670);
  });

  it("adds up a donor's gifts and keeps one-gift donors", () => {
    const r = buildStatements({
      taxYear: 2026,
      lines: [
        line({ invoiceNumber: "INV-1", contactName: "Sample Person 901", unitPriceUsd: 50, invoiceDate: "2026-01-04" }),
        line({ invoiceNumber: "INV-2", contactName: "Sample Person 901", unitPriceUsd: 50, invoiceDate: "2026-01-18" }),
        line({ invoiceNumber: "INV-3", contactName: "Sample Person 911", unitPriceUsd: 250 }),
      ],
    });
    expect(r.totals).toMatchObject({ grandTotalCents: 35000, giftCount: 3, donorCount: 2 });
    expect(r.donors.find((d) => d.name === "Sample Person 911")!.gifts).toHaveLength(1);
  });

  it("leaves out unpaid invoices, other years and non-USD gifts", () => {
    const r = buildStatements({
      taxYear: 2026,
      lines: [
        line({ invoiceNumber: "INV-1", contactName: "A Person", unitPriceUsd: 10, status: "AUTHORISED" }),
        line({ invoiceNumber: "INV-2", contactName: "A Person", unitPriceUsd: 20, invoiceDate: "2025-12-31" }),
        line({ invoiceNumber: "INV-3", contactName: "A Person", unitPriceUsd: 30, currency: "ZAR" }),
        line({ invoiceNumber: "INV-4", contactName: "A Person", unitPriceUsd: 40 }),
      ],
    });
    expect(r.totals.grandTotalCents).toBe(4000);
    expect(r.unpaidGifts).toHaveLength(1);
    expect(r.excludedLines.map((e) => e.reason)).toEqual([
      expect.stringMatching(/outside 2026/),
      expect.stringMatching(/ZAR/),
    ]);
  });

  it("includes non-USD gifts (already converted) when the run says so", () => {
    const r = buildStatements({
      taxYear: 2026,
      options: { includeNonUsd: true },
      lines: [line({ invoiceNumber: "INV-3", contactName: "A Person", unitPriceUsd: 30, currency: "ZAR" })],
    });
    expect(r.totals.grandTotalCents).toBe(3000);
  });

  it("drops pass-through lines like Sample Foundation 921's 10% to FFSA", () => {
    const r = buildStatements({
      taxYear: 2026,
      lines: [line({ invoiceNumber: "INV-9", contactName: "Sample Foundation 921", unitPriceUsd: 12, description: "10% to FFSA" })],
    });
    expect(r.donors).toHaveLength(0);
    expect(r.excludedLines).toHaveLength(1);
  });

  it("never sends a credit-note contact a statement, and matches the donor it names", () => {
    const lines = [
      line({ invoiceNumber: "INV-2213", contactName: "Sample Q Person 913", unitPriceUsd: 75, description: "DTS Donation" }),
      line({ invoiceNumber: "CN-0001", contactName: "Sample Person 912", unitPriceUsd: 75, quantity: -1, description: "DTS Donation - Sample Person 913" }),
    ];
    const r = buildStatements({ taxYear: 2026, lines });
    expect(r.donors.map((d) => d.name)).toEqual(["Sample Q Person 913"]);
    expect(r.creditNotes).toHaveLength(1);
    expect(r.creditNotes[0]).toMatchObject({ amountCents: -7500, matchedDonorName: "Sample Q Person 913" });
    const donor = r.donors[0];
    expect(donor.totalCents).toBe(7500);
    expect(donor.flags.map((f) => f.code)).toEqual(expect.arrayContaining(["credit_note", "dts"]));
    expect(r.totals.creditNoteCents).toBe(-7500);

    // Credit notes on a non-donation account (2850) are still listed.
    const onLiability = buildStatements({
      taxYear: 2026,
      lines: [{ ...lines[0], accountCode: "1010" }, { ...lines[1], accountCode: "2850" }],
    });
    expect(onLiability.creditNotes).toHaveLength(1);
    expect(onLiability.excludedLines).toHaveLength(0);

    const netted = buildStatements({ taxYear: 2026, lines, options: { creditNotes: "net" } });
    expect(netted.donors[0].totalCents).toBe(0);
    expect(netted.totals.donorCount).toBe(0);
  });

  it("flags organisations, event lines, encoding, one-word names and duplicates", () => {
    const r = buildStatements({
      taxYear: 2026,
      lines: [
        line({ invoiceNumber: "INV-1", contactName: "Sample Foundation 918", unitPriceUsd: 500 }),
        line({ invoiceNumber: "INV-2", contactName: "Sample - Partner 919", unitPriceUsd: 624.68 }),
        line({ invoiceNumber: "INV-3", contactName: "Sample Person 900", unitPriceUsd: 40, description: "Wild Ones Fundraiser" }),
        line({ invoiceNumber: "INV-4", contactName: "SamplÃ© Person 902", unitPriceUsd: 6.06 }),
        line({ invoiceNumber: "INV-5", contactName: "Sam", unitPriceUsd: 10 }),
        line({ invoiceNumber: "INV-6", contactName: "Sample Person 901", unitPriceUsd: 50 }),
        line({ invoiceNumber: "INV-7", contactName: "Sample (Nick) Person 901", unitPriceUsd: 50 }),
      ],
    });
    const codes = (name: string) => r.donors.find((d) => d.name === name)!.flags.map((f) => f.code);
    expect(codes("Sample Foundation 918")).toContain("organisation");
    // "Partner" is not an organisation phrase, so this flag comes from the " - " branch.
    const hyphenated = r.donors.find((d) => d.name === "Sample - Partner 919")!;
    expect(hyphenated.flags.find((f) => f.code === "organisation")?.detail).toBe(
      "Looks like an organisation — confirm they get a statement",
    );
    expect(codes("Sample Person 900")).toContain("review_line");
    expect(codes("Samplé Person 902")).toContain("encoding_fixed");
    expect(codes("Sam")).toContain("incomplete_name");
    expect(codes("Sample Person 901")).toContain("possible_duplicate");
    expect(codes("Sample (Nick) Person 901")).toContain("possible_duplicate");
    expect(codes("Sample Person 900")).not.toContain("organisation");
  });

  it("finds emails in order: edit, source row, Xero contacts, Hub", () => {
    const r = buildStatements({
      taxYear: 2026,
      lines: [
        line({ invoiceNumber: "INV-1", contactName: "Has Row Email", unitPriceUsd: 1, email: "row@x.com" }),
        line({ invoiceNumber: "INV-2", contactName: "From Xero", unitPriceUsd: 1 }),
        line({ invoiceNumber: "INV-3", contactName: "From Hub", unitPriceUsd: 1 }),
        line({ invoiceNumber: "INV-4", contactName: "No Email", unitPriceUsd: 1 }),
        line({ invoiceNumber: "INV-5", contactName: "Bad Email", unitPriceUsd: 1 }),
      ],
      contactEmails: { "from xero": "x@xero.com", "has row email": "ignored@xero.com", "bad email": "nope" },
      hubEmails: { "from hub": "h@hub.com", "from xero": "ignored@hub.com" },
      edits: [{ donorKey: "no email", email: null }],
    });
    const by = (n: string) => r.donors.find((d) => d.name === n)!;
    expect(by("Has Row Email")).toMatchObject({ email: "row@x.com", emailSource: "source" });
    expect(by("From Xero")).toMatchObject({ email: "x@xero.com", emailSource: "xero" });
    expect(by("From Hub")).toMatchObject({ email: "h@hub.com", emailSource: "hub" });
    expect(by("No Email").flags.map((f) => f.code)).toContain("missing_email");
    expect(by("Bad Email").flags.map((f) => f.code)).toContain("invalid_email");
    expect(r.totals.missingEmailCount).toBe(2);
  });

  it("applies finance's edits: merge, rename, email, exclude", () => {
    const r = buildStatements({
      taxYear: 2026,
      lines: [
        line({ invoiceNumber: "INV-1", contactName: "Sample Person 901", unitPriceUsd: 50 }),
        line({ invoiceNumber: "INV-2", contactName: "Sample (Nick) Person 901", unitPriceUsd: 50 }),
        line({ invoiceNumber: "INV-3", contactName: "Sample School 920", unitPriceUsd: 840 }),
      ],
      edits: [
        { donorKey: "sample nick person 901", mergeIntoKey: "sample person 901" },
        { donorKey: "sample person 901", displayName: "Sample (N.) Person 901", email: "k@x.com" },
        { donorKey: "sample school 920", excluded: true },
      ],
    });
    const k = r.donors.find((d) => d.key === "sample person 901")!;
    expect(k).toMatchObject({ name: "Sample (N.) Person 901", email: "k@x.com", emailSource: "edit", totalCents: 10000 });
    expect(k.mergedFrom).toEqual(["Sample (Nick) Person 901"]);
    expect(r.totals).toMatchObject({ donorCount: 1, grandTotalCents: 10000, excludedDonorCount: 1, excludedDonorCents: 84000 });
  });
});

describe("matchCreditNoteDonor", () => {
  const donors = [
    { key: "sample q person 913", name: "Sample Q Person 913" },
    { key: "sample person 913x", name: "Sample Person 913x" },
  ];
  it("finds the person in any segment, preferring an exact name", () => {
    const more = [...donors, { key: "sample person 901", name: "Sample Person 901" }, { key: "sample nick person 901", name: "Sample (Nick) Person 901" }, { key: "sample person 914", name: "Sample Person 914" }];
    expect(matchCreditNoteDonor("Donation - DTS - Sample Person 914", more)?.name).toBe("Sample Person 914");
    expect(matchCreditNoteDonor("Donation - DTS Donation  - Sample Person 913", more)?.name).toBe("Sample Q Person 913");
    expect(matchCreditNoteDonor("Donation - Sample Person 901", more)?.name).toBe("Sample Person 901");
    expect(matchCreditNoteDonor("Donation - Sample (Nick) Person 901", more)?.name).toBe("Sample (Nick) Person 901");
    expect(matchCreditNoteDonor("Donation - DTS", more)).toBeNull();
    const onlyShort = [{ key: "sample person 901", name: "Sample Person 901" }];
    expect(matchCreditNoteDonor("Donation - Sample (Nick) Person 901", onlyShort)?.name).toBe("Sample Person 901");
  });

  it("lists donation credit notes on other accounts, but not tuition or refunds", () => {
    const r = buildStatements({
      taxYear: 2026,
      lines: [
        line({ invoiceNumber: "INV-1", contactName: "Sample Person 911", unitPriceUsd: 250, accountCode: "1010" }),
        line({ invoiceNumber: "CN-2096", contactName: "Sample Person 912", unitPriceUsd: 242.45, quantity: -1, accountCode: "2850", description: "Donation - DTS Donation  - Sample Person 911" }),
        line({ invoiceNumber: "CN-2101", contactName: "Sample Person 917", unitPriceUsd: 1000, quantity: -1, accountCode: "4105", description: "Discipleship Training School" }),
        line({ invoiceNumber: "CN-3070", contactName: "Sample Person 915", unitPriceUsd: 750, quantity: -1, accountCode: "1050", description: "Overpayment Refund" }),
      ],
    });
    expect(r.creditNotes.map((c) => c.invoiceNumber)).toEqual(["CN-2096"]);
    expect(r.creditNotes[0].matchedDonorName).toBe("Sample Person 911");
    expect(r.excludedLines.map((e) => e.reason)).toEqual(["Credit note not for a donation", "Credit note not for a donation"]);
  });

  it("needs every named word in the donor's name", () => {
    expect(matchCreditNoteDonor("DTS Donation - Sample Person 913", donors)?.name).toBe("Sample Q Person 913");
    expect(matchCreditNoteDonor("DTS Donation", donors)).toBeNull();
    expect(matchCreditNoteDonor("Refund - Someone Else", donors)).toBeNull();
  });
});

describe("spreadsheet parsing", () => {
  const report: unknown[][] = [
    ["Receivable Invoice Detail"],
    ["FF SA USA, Inc"],
    ["For the period 1 January 2026 to 5 October 2026"],
    ["Account Code contains 1010, 1012, 1013, 1080"],
    ["Status contains Approved, Paid"],
    [],
    [],
    ["Invoice Number", "Invoice Date", "Due Date", "Item Code", "Description", "Quantity", "Original Currency",
      "Invoice Total (Source)", "Balance (Source)", "Unit Price (ex) (USD)", "Invoice Total (USD)", "Balance (USD)", "Contact", "Status"],
    ["INV-2223", 46055, 46055, "", "HULC Donation", 1, "USD", 1406.7, 0, 1000, 1406.7, 0, "Sample Person 910", "Paid"],
    ["INV-2223", 46055, 46055, "", "Donation", 1, "USD", 1406.7, 0, "$500.00", 1406.7, 0, "Sample Person 910", "Paid"],
    ["INV-2300", 46100, 46100, "", "Donation", 1, "USD", 25, 25, 25, 25, 25, "Late Payer", "Approved"],
    ["CN-0001", 46100, 46100, "", "DTS Donation - Sample Person 913", -1, "USD", -75, 0, 75, -75, 0, "Sample Person 912", "Paid"],
    ["Total", "", "", "", "", "", "", "", "", "", 1356.7, 25, "", ""],
  ];

  it("reads a Xero Receivable Invoice Detail export", () => {
    const { lines, warnings } = parseXeroReport(report);
    expect(warnings).toEqual([]);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ invoiceNumber: "INV-2223", invoiceDate: "2026-02-02", unitPriceUsd: 1000, status: "PAID" });
    expect(lines[1].unitPriceUsd).toBe(500);
    expect(lines[2].status).toBe("AUTHORISED");
    expect(lines[3]).toMatchObject({ quantity: -1, unitPriceUsd: 75 });
    const r = buildStatements({ taxYear: 2026, lines });
    expect(r.totals.grandTotalCents).toBe(150000);
    expect(r.unpaidGifts).toHaveLength(1);
    expect(r.creditNotes).toHaveLength(1);
  });

  it("reads the old script's donations list and a contacts tab", () => {
    const parsed = parseWorkbook({
      Donations: [
        ["Donor Name", "Email Address", "Donation Amount", "Donation Date"],
        ["Sample Person 916", "sample916@example.com", "$13.47", "1/2/2026"],
        ["Sample Person 910", "", "$1,500.00", "2/2/2026"],
      ],
      "Email Lookup": [
        ["*ContactName", "AccountNumber", "EmailAddress"],
        ["Sample Person 910", "", "sample910@example.com"],
      ],
      Notes: [["nothing here"]],
    });
    expect(parsed.used.map((u) => u.kind)).toEqual(["donations_list", "contacts"]);
    const r = buildStatements({ taxYear: 2026, lines: parsed.lines, contactEmails: parsed.contactEmails });
    expect(r.totals.grandTotalCents).toBe(151347);
    expect(r.donors.find((d) => d.name === "Sample Person 910")).toMatchObject({ email: "sample910@example.com", emailSource: "xero" });
  });

  it("prefers a real Xero report over a derived list in the same workbook", () => {
    const parsed = parseWorkbook({
      Report: report,
      Donations: [["Donor Name", "Donation Amount"], ["Someone", "$5"]],
    });
    expect(parsed.used.map((u) => u.sheet)).toEqual(["Report"]);
  });

  it("warns instead of guessing on unreadable amounts", () => {
    const { lines, warnings } = parseDonationsList([
      ["Donor Name", "Donation Amount"],
      ["Someone", "about fifty"],
    ]);
    expect(lines).toHaveLength(0);
    expect(warnings[0]).toMatch(/couldn’t be read/);
  });
});


describe("planSends", () => {
  const r = buildStatements({
    taxYear: 2026,
    lines: [
      line({ invoiceNumber: "INV-1", contactName: "Ready Donor", unitPriceUsd: 10, email: "ready@x.com" }),
      line({ invoiceNumber: "INV-2", contactName: "Sent Donor", unitPriceUsd: 10, email: "sent@x.com" }),
      line({ invoiceNumber: "INV-3", contactName: "Paper Donor", unitPriceUsd: 10 }),
      line({ invoiceNumber: "INV-4", contactName: "Left Out", unitPriceUsd: 10, email: "out@x.com" }),
    ],
    edits: [{ donorKey: "left out", excluded: true }],
  });
  const keys = ["ready donor", "sent donor", "paper donor", "left out", "nobody"];

  it("sends only to ready donors not yet sent, and says why the rest were skipped", () => {
    const p = planSends(r.donors, keys, new Set(["sent donor"]));
    expect(p.send.map((d) => d.name)).toEqual(["Ready Donor"]);
    expect(Object.fromEntries(p.skipped.map((s) => [s.key, s.reason]))).toEqual({
      "sent donor": "Already sent this year",
      "paper donor": "No usable email — post a paper statement",
      "left out": "Left out of statements",
      nobody: "Not in this import",
    });
  });

  it("re-sends on purpose, but still never to left-out or email-less donors", () => {
    const p = planSends(r.donors, keys, new Set(["sent donor"]), { resend: true });
    expect(p.send.map((d) => d.name).sort()).toEqual(["Ready Donor", "Sent Donor"]);
    expect(p.skipped.map((s) => s.key).sort()).toEqual(["left out", "nobody", "paper donor"]);
  });
});
