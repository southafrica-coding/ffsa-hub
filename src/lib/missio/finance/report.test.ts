import { describe, expect, it } from "vitest";
import {
  averageCents,
  buildIncomeReport,
  formatRate,
  formatZar,
  formatZarCompact,
  formatZarWhole,
  monthsInRange,
  parseAmountToCents,
  parseRateMicros,
  todayInSast,
  usdToZarCents,
  type SourceAmount,
} from "./report";

// The 19 Nov 2026 report's month-by-source table, as made-up dated amounts
// (one per cell). Test data only: nothing here is read from or written to a DB.
const PDF: Array<[string, Partial<Record<SourceAmount["source"], number>>]> = [
  ["2026-07", { bank: 1052100, fundraiseup: 1066 }],
  ["2026-08", { bank: 5309720, snapscan: 875768, cash: 190000 }],
  ["2026-09", { bank: 5716803, snapscan: 327507, fundraiseup: 2066627, cash: 252000 }],
  ["2026-10", { bank: 2902269, snapscan: 350691, fundraiseup: 1718247, cash: 268000 }],
  ["2026-11", { bank: 324900, fundraiseup: 1116958, cash: 170000 }],
];

function pdfAmounts(): SourceAmount[] {
  return PDF.flatMap(([month, cells]) =>
    Object.entries(cells).map(([source, cents]) => ({ source: source as SourceAmount["source"], date: `${month}-05`, cents: cents! }))
  );
}

describe("buildIncomeReport against the 19 Nov report", () => {
  const report = buildIncomeReport({ fromMonth: "2026-07", today: "2026-11-19", amounts: pdfAmounts() });

  it("matches the total and each source", () => {
    expect(formatZar(report.total)).toBe("R226,426.56");
    const by = Object.fromEntries(report.sources.map((s) => [s.key, s]));
    expect(formatZar(by.bank.total!)).toBe("R153,057.92");
    expect(formatZar(by.snapscan.total!)).toBe("R15,539.66");
    expect(formatZar(by.fundraiseup.total!)).toBe("R49,028.98");
    expect(formatZar(by.cash.total!)).toBe("R8,800.00");
    expect([by.bank.share, by.snapscan.share, by.fundraiseup.share, by.cash.share]).toEqual([67.6, 6.9, 21.7, 3.9]);
  });

  it("averages each source over every month, as the report does", () => {
    const avg = Object.fromEntries(report.sources.map((s) => [s.key, formatZar(s.perMonth!)]));
    expect(avg).toEqual({ bank: "R30,611.58", snapscan: "R3,107.93", fundraiseup: "R9,805.80", cash: "R1,760.00" });
  });

  it("matches each month's total and marks November partial", () => {
    expect(report.months.map((m) => formatZar(m.total))).toEqual([
      "R10,531.66",
      "R63,754.88",
      "R83,629.37",
      "R52,392.07",
      "R16,118.58",
    ]);
    expect(report.months.map((m) => m.partial)).toEqual([false, false, false, false, true]);
    expect(report.months[4].through).toBe("2026-11-19");
    expect(report.months[3].through).toBe("2026-10-31");
  });

  it("leaves a truly empty source-month null, not zero", () => {
    expect(report.months[0].bySource.snapscan).toBeNull();
    expect(report.months[0].bySource.cash).toBeNull();
    expect(report.months[1].bySource.fundraiseup).toBeNull();
    expect(report.months[4].bySource.snapscan).toBeNull();
  });

  it("gives the all-months average", () => {
    expect(formatZar(report.averages.all.cents!)).toBe("R45,285.31");
    expect(report.averages.all.span).toBe("July to November");
  });

  it("gives the strict full-months average: July to October, partial November out", () => {
    expect(report.averages.fullMonths.months).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
    // (10,531.66 + 63,754.88 + 83,629.37 + 52,392.07) / 4 = 52,576.995 → 52,577.00
    expect(formatZar(report.averages.fullMonths.cents!)).toBe("R52,577.00");
  });

  it("also gives the report's normal-month figure: August to October", () => {
    expect(report.averages.normalMonth?.months).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(formatZar(report.averages.normalMonth!.cents!)).toBe("R66,592.11");
    expect(report.averages.normalMonth?.span).toBe("August to October");
  });
});

describe("buildIncomeReport edges", () => {
  it("is empty with no amounts, and every cell is null", () => {
    const r = buildIncomeReport({ fromMonth: "2026-07", today: "2026-11-23", amounts: [] });
    expect(r.hasData).toBe(false);
    expect(r.total).toBe(0);
    expect(r.sources.every((s) => s.total === null && s.share === null && s.perMonth === null)).toBe(true);
    expect(r.months.every((m) => Object.values(m.bySource).every((v) => v === null))).toBe(true);
  });

  it("drops amounts outside the range and after today", () => {
    const r = buildIncomeReport({
      fromMonth: "2026-07",
      today: "2026-11-23",
      amounts: [
        { source: "bank", date: "2026-06-30", cents: 100 },
        { source: "bank", date: "2026-11-24", cents: 100 },
        { source: "bank", date: "not-a-date", cents: 100 },
        { source: "bank", date: "2026-11-23", cents: 250 },
      ],
    });
    expect(r.total).toBe(250);
  });

  it("isn't partial on the month's last day, and has no normal figure without July", () => {
    const r = buildIncomeReport({
      fromMonth: "2026-08",
      today: "2026-10-31",
      amounts: [{ source: "cash", date: "2026-09-01", cents: 300 }],
    });
    expect(r.months.some((m) => m.partial)).toBe(false);
    expect(r.averages.fullMonths.months).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(r.averages.normalMonth).toBeNull();
  });

  it("has no full-month average when the only month is partial", () => {
    const r = buildIncomeReport({ fromMonth: "2026-11", today: "2026-11-23", amounts: [{ source: "cash", date: "2026-11-01", cents: 1 }] });
    expect(r.averages.fullMonths.cents).toBeNull();
    expect(r.averages.all.cents).toBe(1);
  });

  it("counts a zero source amount as present (R0.00), unlike an empty one", () => {
    const r = buildIncomeReport({ fromMonth: "2026-11", today: "2026-11-23", amounts: [{ source: "cash", date: "2026-11-01", cents: 0 }] });
    expect(r.months[0].bySource.cash).toBe(0);
    expect(r.hasData).toBe(true);
  });

  it("lists months across a year end", () => {
    expect(monthsInRange("2026-11", "2027-02-03")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
});

describe("money and dates", () => {
  it("formats rand the way the report does", () => {
    expect(formatZar(22642656)).toBe("R226,426.56");
    expect(formatZar(1066)).toBe("R10.66");
    expect(formatZar(5)).toBe("R0.05");
    expect(formatZar(-120761)).toBe("−R1,207.61");
    expect(formatZarWhole(8362937)).toBe("R83,629");
    expect(formatZarWhole(1053166)).toBe("R10,532");
    expect(formatZarCompact(9_000_000)).toBe("R90k");
    expect(formatZarCompact(0)).toBe("R0");
  });

  it("rounds averages half away from zero", () => {
    expect(averageCents([1, 2])).toBe(2);
    expect(averageCents([])).toBeNull();
  });

  it("parses typed amounts", () => {
    expect(parseAmountToCents("R1,900.00")).toBe(190000);
    expect(parseAmountToCents("1900")).toBe(190000);
    expect(parseAmountToCents("1 900,5")).toBe(190050);
    expect(parseAmountToCents("12.345")).toBeNull();
    expect(parseAmountToCents("-5")).toBeNull();
    expect(parseAmountToCents("")).toBeNull();
  });

  it("converts dollars at a stored rate with integer maths", () => {
    expect(parseRateMicros("18.25")).toBe(18_250_000);
    expect(parseRateMicros("0")).toBeNull();
    expect(parseRateMicros("18.1234567")).toBeNull();
    expect(usdToZarCents(297728, 18_250_000)).toBe(5433536); // $2,977.28 × 18.25 = R54,335.36
    expect(usdToZarCents(1, 18_500_000)).toBe(19); // 18.5c rounds up
    expect(usdToZarCents(3, 16_166_667)).toBe(49); // 48.500001
    expect(formatRate(18_250_000)).toBe("18.25");
    expect(formatRate(17_000_000)).toBe("17");
  });

  it("uses the South African calendar day", () => {
    // 23:30 UTC on 30 Nov is already 1 Dec in Johannesburg.
    expect(todayInSast(new Date("2026-11-30T23:30:00Z"))).toBe("2026-12-01");
  });
});
