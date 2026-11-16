import { describe, expect, it } from "vitest";
import { guessCategory, lineTotal, parseBudgetSheet, parseMoney, type BudgetCategory } from "./outreach-budget";

const names = [
  "Flights", "Visas", "Accommodation", "Food", "Transport", "Ministry", "Translator",
  "Emergency Fund", "Airport Meals", "Airport Run", "First Aid Kit", "Gifts", "Fun",
  "Bank Costs", "Finance Kit", "Pastoral Visit", "Surprise",
];
const CATS: BudgetCategory[] = names.map((name, i) => ({
  id: `c${i}`,
  name,
  slug: name.toLowerCase().replace(/ /g, "-"),
  sort_order: i,
}));
const cat = (description: string) => guessCategory(description, CATS)?.name ?? null;

// Sample Person 50's Botswana sheet as a CSV export reads it: spacer column A,
// currency strings, blank placeholder rows, a spacer row, a total row.
const BOTSWANA: unknown[][] = [
  ["", "", "Amount", "Frequency", "People", "Total"],
  ["", "Emergency Fund", "R3,000.00", "1", "8", "R24,000.00"],
  ["", "Airport Run (within SA)", "", "", "", "R0.00"],
  ["", "", "", "", "", ""],
  ["", "Flights (with insurance)", "", "", "", "R0.00"],
  ["", "", "", "", "", ""],
  ["", "Destination A - Food", "R190.00", "15", "8", "R22,800.00"],
  ["", "Destination A - Accomodation", "", "", "", "R0.00"],
  ["", "Translator", "R500.00", "10", "1", "R5,000.00"],
  ["", "TOTAL", "", "", "", "R51,800.00"],
];

describe("parseBudgetSheet", () => {
  const parsed = parseBudgetSheet(BOTSWANA)!;

  it("finds the header by its words and the description past a spacer column", () => {
    expect(parsed).not.toBeNull();
    expect(parsed.lines.map((l) => l.description)).toEqual([
      "Emergency Fund",
      "Airport Run (within SA)",
      "Flights (with insurance)",
      "Destination A - Food",
      "Destination A - Accomodation",
      "Translator",
    ]);
  });

  it("keeps the numbers the sheet gave", () => {
    const food = parsed.lines.find((l) => l.description === "Destination A - Food")!;
    expect(food).toMatchObject({ amount_zar: 190, frequency: 15, people: 8, sheet_total_zar: 22800 });
  });

  it("keeps blank lines as R0 placeholders, with a blank frequency meaning once", () => {
    const flights = parsed.lines.find((l) => l.description.startsWith("Flights"))!;
    expect(flights).toMatchObject({ amount_zar: 0, frequency: 1, people: null, sheet_total_zar: 0 });
  });

  it("drops the total row", () => {
    expect(parsed.lines.some((l) => /total/i.test(l.description))).toBe(false);
  });

  it("reads the team size off the most common People value", () => {
    expect(parsed.likelyTeamSize).toBe(8);
  });

  it("returns null for a sheet that is not a budget", () => {
    expect(parseBudgetSheet([["Name", "Email"], ["A", "a@b.c"]])).toBeNull();
  });

  it("works with numbers already typed as numbers and no spacer column", () => {
    const p = parseBudgetSheet([
      ["Item", "Amount", "Frequency", "People", "Total"],
      ["Visas", 600, 1, 8, 4800],
    ])!;
    expect(p.lines[0]).toMatchObject({ description: "Visas", amount_zar: 600, frequency: 1, people: 8 });
  });
});

describe("guessCategory", () => {
  it.each([
    ["Emergency Fund", "Emergency Fund"],
    ["Airport Run (within SA)", "Airport Run"],
    ["Flights (with insurance)", "Flights"],
    ["Destination A - Food", "Food"],
    ["Destination A - Accomodation", "Accommodation"],
    ["Destination B – Guesthouse", "Accommodation"],
    ["Taxi to village", "Transport"],
    ["Airport meals Joburg", "Airport Meals"],
  ])("%s → %s", (description, expected) => {
    expect(cat(description)).toBe(expected);
  });

  it("leaves genuinely unknown lines unassigned", () => {
    expect(cat("Something nobody planned for")).toBeNull();
  });
});

describe("lineTotal", () => {
  it("multiplies amount × frequency × team size", () => {
    expect(lineTotal({ amount_zar: 190, frequency: 15, uses_team_size: true, fixed_people: 1 }, 8)).toBe(22800);
  });
  it("follows the team size when it changes", () => {
    expect(lineTotal({ amount_zar: 190, frequency: 15, uses_team_size: true, fixed_people: 1 }, 9)).toBe(25650);
  });
  it("uses the fixed number instead when the line does not follow the team", () => {
    expect(lineTotal({ amount_zar: 500, frequency: 10, uses_team_size: false, fixed_people: 1 }, 8)).toBe(5000);
  });
});

describe("parseMoney", () => {
  it.each([
    ["R3,000.00", 3000],
    ["R 1 200", 1200],
    [" 15 ", 15],
    [42, 42],
    ["", null],
    ["—", null],
  ])("%s → %s", (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });
});
