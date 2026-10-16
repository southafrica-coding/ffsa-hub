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
    expect(fixEncoding("HÃ©drik Agenbag")).toBe("Hédrik Agenbag");
    expect(fixEncoding("JunÃ© Joubert")).toBe("Juné Joubert");
    expect(fixEncoding("Abigail Kolbé")).toBe("Abigail Kolbé");
    expect(fixEncoding("Plain Name")).toBe("Plain Name");
  });

  it("groups names regardless of case, accents and spacing", () => {
    expect(donorKey("  Hédrik  Agenbag ")).toBe(donorKey("HÃ©drik Agenbag"));
    expect(donorKey("PETER C GILL")).toBe("peter c gill");
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
        line({ invoiceNumber: "INV-2223", contactName: "Briana Boll", unitPriceUsd: 1000, description: "HULC Donation", invoiceTotalUsd: 1406.7 }),
        line({ invoiceNumber: "INV-2223", contactName: "Briana Boll", unitPriceUsd: 500, description: "Donation", invoiceTotalUsd: 1406.7 }),
        line({ invoiceNumber: "INV-2223", contactName: "Briana Boll", unitPriceUsd: -93.3, itemCode: "STRIPE", description: "Stripe Card Processing Fee", invoiceTotalUsd: 1406.7 }),
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
      lines: [line({ invoiceNumber: "INV-1", contactName: "Briana Boll", unitPriceUsd: 1500, invoiceTotalUsd: 1406.7 })],
    });
    expect(r.totals.grandTotalCents).toBe(140670);
  });

  it("adds up a donor's gifts and keeps one-gift donors", () => {
    const r = buildStatements({
      taxYear: 2026,
      lines: [
        line({ invoiceNumber: "INV-1", contactName: "Kassandra Aleck", unitPriceUsd: 50, invoiceDate: "2026-01-04" }),
        line({ invoiceNumber: "INV-2", contactName: "Kassandra Aleck", unitPriceUsd: 50, invoiceDate: "2026-01-18" }),
        line({ invoiceNumber: "INV-3", contactName: "Owen Veer", unitPriceUsd: 250 }),
      ],
    });
    expect(r.totals).toMatchObject({ grandTotalCents: 35000, giftCount: 3, donorCount: 2 });
    expect(r.donors.find((d) => d.name === "Owen Veer")!.gifts).toHaveLength(1);
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

  it("drops pass-through lines like Distrokid's 10% to FFSA", () => {
    const r = buildStatements({
      taxYear: 2026,
      lines: [line({ invoiceNumber: "INV-9", contactName: "Distrokid", unitPriceUsd: 12, description: "10% to FFSA" })],
    });
    expect(r.donors).toHaveLength(0);
    expect(r.excludedLines).toHaveLength(1);
  });

  it("never sends a credit-note contact a statement, and matches the donor it names", () => {
    const lines = [
      line({ invoiceNumber: "INV-2213", contactName: "Peter C Gill", unitPriceUsd: 75, description: "DTS Donation" }),
      line({ invoiceNumber: "CN-0001", contactName: "Parker Pollard", unitPriceUsd: 75, quantity: -1, description: "DTS Donation - Peter Gill" }),
    ];
    const r = buildStatements({ taxYear: 2026, lines });
    expect(r.donors.map((d) => d.name)).toEqual(["Peter C Gill"]);
    expect(r.creditNotes).toHaveLength(1);
    expect(r.creditNotes[0]).toMatchObject({ amountCents: -7500, matchedDonorName: "Peter C Gill" });
    const peter = r.donors[0];
    expect(peter.totalCents).toBe(7500);
    expect(peter.flags.map((f) => f.code)).toEqual(expect.arrayContaining(["credit_note", "dts"]));
    expect(r.totals.creditNoteCents).toBe(-7500);

    const netted = buildStatements({ taxYear: 2026, lines, options: { creditNotes: "net" } });
    expect(netted.donors[0].totalCents).toBe(0);
    expect(netted.totals.donorCount).toBe(0);
  });

  it("flags organisations, event lines, encoding, one-word names and duplicates", () => {
    const r = buildStatements({
      taxYear: 2026,
      lines: [
        line({ invoiceNumber: "INV-1", contactName: "Fidelity Charitable", unitPriceUsd: 500 }),
        line({ invoiceNumber: "INV-2", contactName: "Austin - Stratum Tech", unitPriceUsd: 624.68 }),
        line({ invoiceNumber: "INV-3", contactName: "Jo Smith", unitPriceUsd: 40, description: "Wild Ones Fundraiser" }),
        line({ invoiceNumber: "INV-4", contactName: "HÃ©drik Agenbag", unitPriceUsd: 6.06 }),
        line({ invoiceNumber: "INV-5", contactName: "Anna", unitPriceUsd: 10 }),
        line({ invoiceNumber: "INV-6", contactName: "Kassandra Aleck", unitPriceUsd: 50 }),
        line({ invoiceNumber: "INV-7", contactName: "Kassandra Desiree Aleck", unitPriceUsd: 50 }),
      ],
    });
    const codes = (name: string) => r.donors.find((d) => d.name === name)!.flags.map((f) => f.code);
    expect(codes("Fidelity Charitable")).toContain("organisation");
    expect(codes("Austin - Stratum Tech")).toContain("organisation");
    expect(codes("Jo Smith")).toContain("review_line");
    expect(codes("Hédrik Agenbag")).toContain("encoding_fixed");
    expect(codes("Anna")).toContain("incomplete_name");
    expect(codes("Kassandra Aleck")).toContain("possible_duplicate");
    expect(codes("Kassandra Desiree Aleck")).toContain("possible_duplicate");
    expect(codes("Jo Smith")).not.toContain("organisation");
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
        line({ invoiceNumber: "INV-1", contactName: "Kassandra Aleck", unitPriceUsd: 50 }),
        line({ invoiceNumber: "INV-2", contactName: "Kassandra Desiree Aleck", unitPriceUsd: 50 }),
        line({ invoiceNumber: "INV-3", contactName: "Keswick Christian School", unitPriceUsd: 840 }),
      ],
      edits: [
        { donorKey: "kassandra desiree aleck", mergeIntoKey: "kassandra aleck" },
        { donorKey: "kassandra aleck", displayName: "Kassandra D. Aleck", email: "k@x.com" },
        { donorKey: "keswick christian school", excluded: true },
      ],
    });
    const k = r.donors.find((d) => d.key === "kassandra aleck")!;
    expect(k).toMatchObject({ name: "Kassandra D. Aleck", email: "k@x.com", emailSource: "edit", totalCents: 10000 });
    expect(k.mergedFrom).toEqual(["Kassandra Desiree Aleck"]);
    expect(r.totals).toMatchObject({ donorCount: 1, grandTotalCents: 10000, excludedDonorCount: 1, excludedDonorCents: 84000 });
  });
});

describe("matchCreditNoteDonor", () => {
  const donors = [
    { key: "peter c gill", name: "Peter C Gill" },
    { key: "peter gillespie", name: "Peter Gillespie" },
  ];
  it("needs every named word in the donor's name", () => {
    expect(matchCreditNoteDonor("DTS Donation - Peter Gill", donors)?.name).toBe("Peter C Gill");
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
    ["INV-2223", 46055, 46055, "", "HULC Donation", 1, "USD", 1406.7, 0, 1000, 1406.7, 0, "Briana Boll", "Paid"],
    ["INV-2223", 46055, 46055, "", "Donation", 1, "USD", 1406.7, 0, "$500.00", 1406.7, 0, "Briana Boll", "Paid"],
    ["INV-2300", 46100, 46100, "", "Donation", 1, "USD", 25, 25, 25, 25, 25, "Late Payer", "Approved"],
    ["CN-0001", 46100, 46100, "", "DTS Donation - Peter Gill", -1, "USD", -75, 0, 75, -75, 0, "Parker Pollard", "Paid"],
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
        ["Juan Kidd", "juan@example.com", "$13.47", "1/2/2026"],
        ["Briana Boll", "", "$1,500.00", "2/2/2026"],
      ],
      "Email Lookup": [
        ["*ContactName", "AccountNumber", "EmailAddress"],
        ["Briana Boll", "", "briana@example.com"],
      ],
      Notes: [["nothing here"]],
    });
    expect(parsed.used.map((u) => u.kind)).toEqual(["donations_list", "contacts"]);
    const r = buildStatements({ taxYear: 2026, lines: parsed.lines, contactEmails: parsed.contactEmails });
    expect(r.totals.grandTotalCents).toBe(151347);
    expect(r.donors.find((d) => d.name === "Briana Boll")).toMatchObject({ email: "briana@example.com", emailSource: "xero" });
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
