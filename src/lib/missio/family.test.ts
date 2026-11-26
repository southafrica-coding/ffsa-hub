import { describe, expect, it, vi } from "vitest";
import { buildFamilies, familiesFor, type FamilyMemberRow } from "@/lib/missio/family";
import { ageFromBirthYear, ageWords, childrenPhrase, familyLine, isNotSpouseLabel, johannesburgYear } from "@/lib/missio/family-format";

// Made-up names only. "Today" is fixed.
const NOW = new Date("2026-06-01T08:00:00+02:00");

function adult(household: string, contact: string, label: string | null = null, at = "2026-01-01"): FamilyMemberRow {
  return { household_id: household, kind: "adult", contact_id: contact, first_name: null, birth_year: null, label, created_at: at };
}
function child(household: string, first: string, year: number | null, at = "2026-02-01"): FamilyMemberRow {
  return { household_id: household, kind: "child", contact_id: null, first_name: first, birth_year: year, label: null, created_at: at };
}

const names = new Map([
  ["c-esther", { personId: "p-esther", firstName: "Esther" }],
  ["c-johan", { personId: "p-johan", firstName: "Johan" }],
  ["c-ruth", { personId: "p-ruth", firstName: "Ruth" }],
  ["c-ben", { personId: "p-ben", firstName: "Ben" }],
]);

describe("age from birth year", () => {
  it("uses the calendar year in Johannesburg", () => {
    expect(ageFromBirthYear(2019, NOW)).toBe(7);
    // 31 Dec 23:30 UTC is already 1 Jan in Johannesburg.
    const newYear = new Date("2026-12-31T23:30:00Z");
    expect(johannesburgYear(newYear)).toBe(2027);
    expect(ageFromBirthYear(2019, newYear)).toBe(8);
  });

  it("is null with no year or a future year, and 0 for this year", () => {
    expect(ageFromBirthYear(null, NOW)).toBeNull();
    expect(ageFromBirthYear(undefined, NOW)).toBeNull();
    expect(ageFromBirthYear(2027, NOW)).toBeNull();
    expect(ageFromBirthYear(2026, NOW)).toBe(0);
  });

  it("reads as words on the card", () => {
    expect(ageWords(7)).toBe("7 years old");
    expect(ageWords(1)).toBe("1 year old");
    expect(ageWords(0)).toBe("Under 1 year old");
  });
});

describe("family line copy", () => {
  it("says who they're married to and names the children with ages", () => {
    expect(
      familyLine({
        householdId: "h",
        spouse: { personId: "p-johan", firstName: "Johan", label: "Husband" },
        children: [
          { firstName: "Maya", age: 7 },
          { firstName: "Daniel", age: 4 },
        ],
      })
    ).toBe("Married to Johan · Maya, 7 and Daniel, 4");
  });

  it("handles one child, a child without a year, and three children", () => {
    expect(childrenPhrase([{ firstName: "Maya", age: 7 }])).toBe("Maya, 7");
    expect(childrenPhrase([{ firstName: "Maya", age: null }])).toBe("Maya");
    expect(childrenPhrase([{ firstName: "Maya", age: 7 }, { firstName: "Sam", age: null }])).toBe("Maya, 7 and Sam");
    expect(
      childrenPhrase([
        { firstName: "Maya", age: 7 },
        { firstName: "Daniel", age: 4 },
        { firstName: "Sam", age: 0 },
      ])
    ).toBe("Maya, 7; Daniel, 4 and Sam, under 1");
  });

  it("never says married for other adults", () => {
    expect(
      familyLine({ householdId: "h", otherAdults: [{ personId: "p", firstName: "Ruth", label: "mom" }], children: [] })
    ).toBe("With Ruth · mom");
    expect(
      familyLine({
        householdId: "h",
        otherAdults: [
          { personId: "p-johan", firstName: "Johan", label: "Husband" },
          { personId: "p-ruth", firstName: "Ruth", label: "mom" },
        ],
        children: [{ firstName: "Maya", age: 7 }],
      })
    ).toBe("With Johan (Husband) and Ruth (mom) · Maya, 7");
  });

  it("is empty with no family, or a household of one with no children", () => {
    expect(familyLine(undefined)).toBe("");
    expect(familyLine({ householdId: "h", children: [] })).toBe("");
    expect(familyLine({ householdId: "h", children: [{ firstName: "Maya", age: 7 }] })).toBe("Maya, 7");
  });

  it("knows which labels aren't a spouse", () => {
    for (const label of ["mom", "Mother", "Johan's mom", "step-dad", "Friend", "ouma"]) expect(isNotSpouseLabel(label)).toBe(true);
    for (const label of [null, "", "Husband", "wife", "partner", "spouse"]) expect(isNotSpouseLabel(label)).toBe(false);
  });
});

describe("buildFamilies", () => {
  it("gives each adult of a couple the other as spouse, and the children to both", () => {
    const rows = [adult("h1", "c-esther"), adult("h1", "c-johan", "Husband"), child("h1", "Daniel", 2022), child("h1", "Maya", 2019)];
    const out = buildFamilies(["c-esther", "c-johan", "c-lila"], rows, names, NOW);
    expect(out.get("c-esther")).toEqual({
      householdId: "h1",
      spouse: { personId: "p-johan", firstName: "Johan", label: "Husband" },
      children: [
        { firstName: "Maya", age: 7 },
        { firstName: "Daniel", age: 4 },
      ],
    });
    expect(out.get("c-johan")?.spouse).toEqual({ personId: "p-esther", firstName: "Esther", label: null });
    expect(out.get("c-johan")?.children).toHaveLength(2);
    // Not in a household: no entry at all.
    expect(out.has("c-lila")).toBe(false);
    expect(familyLine(out.get("c-esther"))).toBe("Married to Johan · Maya, 7 and Daniel, 4");
  });

  it("lists every other adult when there are three", () => {
    const rows = [adult("h1", "c-esther", null, "1"), adult("h1", "c-johan", "Husband", "2"), adult("h1", "c-ruth", "mom", "3")];
    const out = buildFamilies(["c-esther"], rows, names, NOW).get("c-esther")!;
    expect(out.spouse).toBeUndefined();
    expect(out.otherAdults).toEqual([
      { personId: "p-johan", firstName: "Johan", label: "Husband" },
      { personId: "p-ruth", firstName: "Ruth", label: "mom" },
    ]);
  });

  it("doesn't call a 'mom' (on either side) a spouse", () => {
    const rows = [adult("h1", "c-esther"), adult("h1", "c-ben", "son")];
    const out = buildFamilies(["c-esther", "c-ben"], rows, names, NOW);
    expect(out.get("c-ben")).toEqual({ householdId: "h1", otherAdults: [{ personId: "p-esther", firstName: "Esther", label: null }], children: [] });
    expect(familyLine(out.get("c-esther"))).toBe("With Ben · son");
  });

  it("leaves out an adult whose name can't be read, and a child with no year gets no age", () => {
    const rows = [adult("h1", "c-esther"), adult("h1", "c-unknown"), child("h1", "Sam", null)];
    const out = buildFamilies(["c-esther"], rows, names, NOW).get("c-esther")!;
    expect(out).toEqual({ householdId: "h1", children: [{ firstName: "Sam", age: null }] });
  });

  it("carries no surnames, birth years or contact details", () => {
    const rows = [adult("h1", "c-esther"), adult("h1", "c-johan"), { ...child("h1", "Maya", 2019), last_name: "Naidoo" } as FamilyMemberRow];
    const json = JSON.stringify([...buildFamilies(["c-esther"], rows, names, NOW).values()]);
    expect(json).not.toMatch(/Naidoo|2019|birth|phone|email/i);
  });
});

describe("familiesFor", () => {
  type Result = { data: unknown; error: { message: string } | null };
  function fakeDb(tables: Record<string, Result>) {
    const calls: string[] = [];
    const from = vi.fn((table: string) => {
      calls.push(table);
      const result = tables[table] ?? { data: [], error: null };
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in"]) chain[method] = () => chain;
      chain.then = (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve);
      return chain;
    });
    return { db: { from }, calls };
  }

  it("is an empty map for people in no household, without reading further", async () => {
    const { db, calls } = fakeDb({ missio_household_members: { data: [], error: null } });
    expect(await familiesFor(db, "org", ["c-lila"], NOW)).toEqual(new Map());
    expect(calls).toEqual(["missio_household_members"]);
  });

  it("is null when a read fails, so no family is invented", async () => {
    const { db } = fakeDb({ missio_household_members: { data: null, error: { message: "boom" } } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await familiesFor(db, "org", ["c-esther"], NOW)).toBeNull();
    spy.mockRestore();
  });

  it("is null when the names can't be read", async () => {
    let memberReads = 0;
    const db = {
      from: (table: string) => {
        const result: Result =
          table === "missio_household_members"
            ? memberReads++ === 0
              ? { data: [{ household_id: "h1", contact_id: "c-esther" }], error: null }
              : { data: [adult("h1", "c-esther"), adult("h1", "c-johan")], error: null }
            : table === "missio_households"
              ? { data: [{ id: "h1" }], error: null }
              : { data: null, error: { message: "directory down" } };
        const chain: Record<string, unknown> = {};
        for (const method of ["select", "eq", "in"]) chain[method] = () => chain;
        chain.then = (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve);
        return chain;
      },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await familiesFor(db, "org", ["c-esther"], NOW)).toBeNull();
    spy.mockRestore();
  });
});
