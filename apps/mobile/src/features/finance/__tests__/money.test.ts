import { barFill, budgetFigures, budgetLines, formatMoney, moneyLabel, normaliseCurrency, sumBy, toNumber } from "../money";

const NBSP = " ";
const plain = (s: string) => s.replaceAll(NBSP, " ");

describe("formatMoney", () => {
  it("formats rand like the web: R, space-grouped thousands", () => {
    expect(plain(formatMoney(38800, "ZAR", { cents: false }))).toBe("R 38 800");
    expect(plain(formatMoney(1234.5, "ZAR"))).toBe("R 1 234.50");
    expect(plain(formatMoney(0, "ZAR"))).toBe("R 0.00");
    expect(plain(formatMoney(999, "ZAR", { cents: false }))).toBe("R 999");
    expect(plain(formatMoney(1234567.891, "ZAR"))).toBe("R 1 234 567.89");
  });

  it("uses no-break spaces so an amount never wraps", () => {
    expect(formatMoney(38800, "ZAR", { cents: false })).toBe(`R${NBSP}38${NBSP}800`);
  });

  it("shows other currencies by code", () => {
    expect(plain(formatMoney(12.5, "usd"))).toBe("USD 12.50");
    expect(plain(formatMoney(120000, "BIF", { cents: false }))).toBe("BIF 120 000");
  });

  it("puts a real minus sign in front of negatives", () => {
    expect(plain(formatMoney(-80, "ZAR", { cents: false }))).toBe("−R 80");
  });

  it("falls back to rand for a missing or odd currency", () => {
    expect(normaliseCurrency(null)).toBe("ZAR");
    expect(normaliseCurrency("rands")).toBe("ZAR");
    expect(plain(formatMoney(5, undefined))).toBe("R 5.00");
  });

  it("rounds half-cents", () => {
    expect(plain(formatMoney(0.005, "ZAR"))).toBe("R 0.01");
    expect(plain(formatMoney(10.499, "ZAR", { cents: false }))).toBe("R 10");
  });
});

describe("moneyLabel (what a screen reader says)", () => {
  it("says rand, not 'R'", () => {
    expect(moneyLabel(38800, "ZAR", { cents: false })).toBe("38800 rand");
    expect(moneyLabel(12.5, "ZAR")).toBe("12.50 rand");
    expect(moneyLabel(12, "ZAR")).toBe("12 rand");
    expect(moneyLabel(-80, "ZAR")).toBe("minus 80 rand");
    expect(moneyLabel(3, "USD")).toBe("3 USD");
  });
});

describe("toNumber", () => {
  it("reads Postgres numerics sent as strings and ignores junk", () => {
    expect(toNumber("120.50")).toBe(120.5);
    expect(toNumber(7)).toBe(7);
    expect(toNumber(null)).toBe(0);
    expect(toNumber("")).toBe(0);
    expect(toNumber("abc")).toBe(0);
    expect(toNumber(Number.NaN)).toBe(0);
  });
});

describe("budgetFigures", () => {
  it("works out spent, remaining and percent (rounded down, one decimal)", () => {
    const f = budgetFigures(1000, 333.33);
    expect(f).toMatchObject({ total: 1000, spent: 333.33, remaining: 666.67, pctSpent: 33.3, over: false });
    expect(f.ratio).toBeCloseTo(0.33333, 5);
    // Never reads 100% before the last cent is spent.
    expect(budgetFigures(1000, 999.99).pctSpent).toBe(99.9);
    expect(budgetFigures(1000, 1000).pctSpent).toBe(100);
  });

  it("flags overspending with a negative remaining", () => {
    const f = budgetFigures(500, 650);
    expect(f.over).toBe(true);
    expect(f.remaining).toBe(-150);
    expect(f.pctSpent).toBe(130);
  });

  it("has no ratio without a budget (no ratio, no bar)", () => {
    expect(budgetFigures(0, 0)).toMatchObject({ ratio: null, pctSpent: null, over: false });
    expect(budgetFigures(0, 50)).toMatchObject({ ratio: null, over: true, remaining: -50 });
  });

  it("keeps money maths to the cent", () => {
    expect(budgetFigures(0.3, 0.1).remaining).toBe(0.2);
  });
});

describe("barFill", () => {
  it("clamps to 0..1", () => {
    expect(barFill(null)).toBe(0);
    expect(barFill(0.42)).toBe(0.42);
    expect(barFill(1.3)).toBe(1);
    expect(barFill(-1)).toBe(0);
    expect(barFill(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("budgetLines", () => {
  const categories = [
    { id: "food", name: "Food", sort_order: 2 },
    { id: "travel", name: "Travel", sort_order: 1 },
    { id: "unused", name: "Unused", sort_order: 3 },
  ];

  it("joins budgets and spending per budget line, in category order", () => {
    const lines = budgetLines(
      categories,
      [
        { category_id: "food", budget_amount_zar: "1000" },
        { category_id: "travel", budget_amount_zar: 5000 },
      ],
      [
        { category_id: "food", zar_amount: "250.50" },
        { category_id: "food", zar_amount: 100 },
        { category_id: "travel", zar_amount: 6000 },
      ],
    );
    expect(lines.map((l) => [l.name, l.total, l.spent, l.remaining, l.over, l.count])).toEqual([
      ["Travel", 5000, 6000, -1000, true, 1],
      ["Food", 1000, 350.5, 649.5, false, 2],
    ]);
  });

  it("keeps spending on a line with no budget, and names unknown categories", () => {
    const lines = budgetLines(categories, [], [{ category_id: "ghost", zar_amount: 20 }]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ name: "Other", total: 0, spent: 20, ratio: null });
  });
});

describe("sumBy", () => {
  it("sums to the cent", () => {
    expect(sumBy([{ a: "0.1" }, { a: 0.2 }], (r) => r.a)).toBe(0.3);
  });
});
