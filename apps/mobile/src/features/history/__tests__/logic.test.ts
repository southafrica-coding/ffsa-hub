import { application, document, emptyHistory, enrollment, history, payment } from "../__fixtures__/fixtures";
import { detailEntries, formatAmount, formatDate, formatRange, recordA11yLabel, safeFileUrl, toSections, totalRecords } from "../logic";

describe("totalRecords / toSections", () => {
  it("counts every record across the four lists", () => {
    expect(totalRecords(emptyHistory())).toBe(0);
    expect(totalRecords(history())).toBe(4);
    expect(totalRecords(history({ payments: [payment(), payment({ id: "p2" })] }))).toBe(5);
  });

  it("keeps the web's order and leaves out empty sections", () => {
    expect(toSections(history()).map((s) => s.title)).toEqual(["Applications", "Training attended", "Payments", "Documents"]);
    expect(toSections(history({ applications: [], payments: [] })).map((s) => s.kind)).toEqual(["enrollments", "documents"]);
    expect(toSections(emptyHistory())).toEqual([]);
  });

  it("rows read like the web's: title, subtitle, date label and date", () => {
    const [apps, enrols, pays, docs] = toSections(history());
    expect(apps.records[0]).toMatchObject({ title: "DTS", subtitle: "2019 Winter · accepted", dateLabel: "Submitted", date: "12 Mar 2019", fileUrl: null });
    expect(enrols.records[0]).toMatchObject({ title: "DTS Cape Town", subtitle: "DTS · student", dateLabel: "Dates", date: "1 Jul 2019 – 13 Dec 2019" });
    expect(pays.records[0]).toMatchObject({ title: "ZAR 1,500.00", subtitle: "School fees deposit", dateLabel: "Paid", date: "2 Apr 2019" });
    expect(docs.records[0]).toMatchObject({ title: "Passport", subtitle: "A0000000", dateLabel: "Expires", date: "31 Jan 2029", fileUrl: "https://files.example.test/passport.pdf" });
  });

  it("falls back like the web when fields are missing", () => {
    const [apps, enrols, pays, docs] = toSections({
      applications: [application({ program_name: null, cohort: null, status: null, submitted_at: null })],
      enrollments: [enrollment({ school_name: null, program_name: null, role: null, start_date: null, end_date: null })],
      payments: [payment({ amount: null, description: null, paid_at: null })],
      documents: [document({ doc_type: null, identifier: null, expires_at: null, file_url: null })],
    });
    expect(apps.records[0]).toMatchObject({ title: "Application", subtitle: null, date: null });
    expect(enrols.records[0]).toMatchObject({ title: "Enrollment", subtitle: null, date: null });
    expect(pays.records[0]).toMatchObject({ title: "Payment", subtitle: null, date: null });
    expect(docs.records[0]).toMatchObject({ title: "Document", subtitle: null, date: null, fileUrl: null });
    // A school name missing: the programme becomes the title.
    expect(toSections(history({ enrollments: [enrollment({ school_name: null })] }))[1].records[0].title).toBe("DTS");
  });

  it("keys are unique across sections even when ids repeat", () => {
    const same = history({ applications: [application({ id: "x" })], payments: [payment({ id: "x" })] });
    const keys = toSections(same).flatMap((s) => s.records.map((r) => r.key));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("formatting", () => {
  it("dates: date or timestamp to '12 Mar 2019'; odd text passes through", () => {
    expect(formatDate("2019-03-12")).toBe("12 Mar 2019");
    expect(formatDate("2019-03-12T23:30:00+00:00")).toBe("12 Mar 2019");
    expect(formatDate(null)).toBeNull();
    expect(formatDate("sometime in 2019")).toBe("sometime in 2019");
    expect(formatDate("2019-13-40")).toBe("2019-13-40");
  });

  it("ranges: both ends, or whichever is known", () => {
    expect(formatRange("2019-07-01", "2019-12-13")).toBe("1 Jul 2019 – 13 Dec 2019");
    expect(formatRange("2019-07-01", null)).toBe("1 Jul 2019");
    expect(formatRange(null, "2019-12-13")).toBe("13 Dec 2019");
    expect(formatRange(null, null)).toBeNull();
  });

  it("amounts: grouped, two decimals, currency as given", () => {
    expect(formatAmount(1500, "ZAR")).toBe("ZAR 1,500.00");
    expect(formatAmount(1234567.5, " usd ")).toBe("usd 1,234,567.50");
    expect(formatAmount(-20, "ZAR")).toBe("ZAR -20.00");
    expect(formatAmount(0, null)).toBe("0.00");
    expect(formatAmount(null, "ZAR")).toBeNull();
  });

  it("details: every raw field as text, blanks as a dash, objects as JSON", () => {
    expect(detailEntries({ a: "x", b: null, c: "", d: 3, e: true, f: { g: 1 } })).toEqual([
      { label: "a", value: "x" },
      { label: "b", value: "—" },
      { label: "c", value: "—" },
      { label: "d", value: "3" },
      { label: "e", value: "true" },
      { label: "f", value: '{"g":1}' },
    ]);
    expect(detailEntries({})).toEqual([]);
  });

  it("file links: only http(s) URLs and website paths are offered", () => {
    expect(safeFileUrl("https://x.test/a.pdf")).toBe("https://x.test/a.pdf");
    expect(safeFileUrl(" http://x.test/a.pdf ")).toBe("http://x.test/a.pdf");
    expect(safeFileUrl("/files/a.pdf")).toBe("/files/a.pdf");
    expect(safeFileUrl("//evil.test/a")).toBeNull();
    expect(safeFileUrl("javascript:alert(1)")).toBeNull();
    expect(safeFileUrl("file:///etc/passwd")).toBeNull();
    expect(safeFileUrl("documents/a.pdf")).toBeNull();
    expect(safeFileUrl(null)).toBeNull();
  });

  it("a row's spoken label carries the date with its label", () => {
    const [apps] = toSections(history());
    expect(recordA11yLabel(apps.records[0])).toBe("DTS. 2019 Winter · accepted. Submitted 12 Mar 2019");
    const bare = toSections(history({ applications: [application({ cohort: null, status: null, submitted_at: null })] }))[0].records[0];
    expect(recordA11yLabel(bare)).toBe("DTS");
  });
});
