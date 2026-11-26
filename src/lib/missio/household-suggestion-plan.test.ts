import { describe, expect, it, vi } from "vitest";
import {
  canonicalPair,
  formatSuggestionSummary,
  groupCouplePairs,
  parseCoupleCsv,
  parseSuggestionCli,
  planHouseholdSuggestions,
  runHouseholdSuggestions,
  type SuggestionSnapshot,
} from "./household-suggestion-plan";

// Synthetic people only. Never real sheet names.
const ESTHER = "a0000000-0000-4000-8000-000000000001";
const JOHAN = "b0000000-0000-4000-8000-000000000002";
const GIDEON = "c0000000-0000-4000-8000-000000000003";
const RILEY = "d0000000-0000-4000-8000-000000000004";
const SAM_H2 = "e0000000-0000-4000-8000-000000000005";
const SAM_H3 = "f0000000-0000-4000-8000-000000000006";
const LEE = "f1000000-0000-4000-8000-000000000007";

const CSV = [
  "source_line,house,role,raw_name,first,last,people_count_on_row,kind,note,part_index,parts_in_row",
  '12,2,Leader 1,"Esther & Johan Naidoo",Esther,Naidoo,2,couple_split,,0,2',
  '12,2,Leader 1,"Esther & Johan Naidoo",Johan,Naidoo,2,couple_split,,1,2',
  '30,6,Member,"Gideon & Riley Example",Gideon,Example,2,couple_split,,0,2',
  '30,6,Member,"Gideon & Riley Example",Riley,Example,2,couple_split,,1,2',
  "31,6,Member,The Example family,,Example,0,family_label,,0,1",
  "32,6,Member,Ana Person,Ana,Person,1,person,,0,1",
].join("\n");

function contact(id: string, first: string, last: string, preferred: string | null = null) {
  return { id, firstName: first, lastName: last, preferredName: preferred };
}

function snapshot(over: Partial<SuggestionSnapshot> = {}): SuggestionSnapshot {
  return {
    contacts: [
      contact(ESTHER, "Esther", "Naidoo"),
      contact(JOHAN, "Johan", "Naidoo"),
      contact(GIDEON, "Gideon", "Example"),
      contact(RILEY, "Riley", "Example"),
    ],
    houseMembers: [],
    householdAdults: [],
    existing: [],
    ...over,
  };
}

const pairOf = (sourceLine: number, house: number, a: [string, string], b: [string, string]) => ({
  sourceLine,
  houseNumber: house,
  people: [
    { first: a[0], last: a[1] },
    { first: b[0], last: b[1] },
  ] as [{ first: string; last: string }, { first: string; last: string }],
});

describe("CSV", () => {
  it("reads the import's parsed-people shape and keeps only couple_split rows", () => {
    const parsed = parseCoupleCsv(CSV);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.rows).toHaveLength(4);
    expect(parsed.otherRows).toBe(2);
    const { pairs, badPairs } = groupCouplePairs(parsed.rows);
    expect(badPairs).toBe(0);
    expect(pairs.map((pair) => [pair.sourceLine, pair.houseNumber, pair.people.map((p) => p.first).join("+")])).toEqual([
      [12, 2, "Esther+Johan"],
      [30, 6, "Gideon+Riley"],
    ]);
  });

  it("only needs the six columns", () => {
    const parsed = parseCoupleCsv("source_line,house,first,last,kind,part_index\n4,1,Esther,Naidoo,couple_split,1\n4,1,Johan,Naidoo,couple_split,2\n");
    expect(parsed.ok && groupCouplePairs(parsed.rows).pairs).toHaveLength(1);
    expect(parseCoupleCsv("source_line,house,first,kind,part_index\n")).toEqual({ ok: false, error: "The CSV is missing column last." });
  });

  it("a line with one half, three parts, or two houses is not a pair", () => {
    const rows = [
      { sourceLine: 1, houseNumber: 1, first: "A", last: "X", kind: "couple_split", partIndex: 0 },
      { sourceLine: 2, houseNumber: 1, first: "A", last: "X", kind: "couple_split", partIndex: 0 },
      { sourceLine: 2, houseNumber: 1, first: "B", last: "X", kind: "couple_split", partIndex: 1 },
      { sourceLine: 2, houseNumber: 1, first: "C", last: "X", kind: "couple_split", partIndex: 2 },
      { sourceLine: 3, houseNumber: 1, first: "A", last: "X", kind: "couple_split", partIndex: 0 },
      { sourceLine: 3, houseNumber: 2, first: "B", last: "X", kind: "couple_split", partIndex: 1 },
    ];
    expect(groupCouplePairs(rows)).toEqual({ pairs: [], badPairs: 3 });
  });
});

describe("planner", () => {
  it("files a pair when both halves match exactly one Missio person", () => {
    const plan = planHouseholdSuggestions([pairOf(30, 6, ["Gideon", "Example"], ["Riley", "Example"])], snapshot());
    expect(plan.suggestions).toEqual([{ contactA: GIDEON, contactB: RILEY, sourceLine: 30 }]);
    expect(plan.summary.toFile).toBe(1);
  });

  it("matches with the import's name rules: accents, case and preferred name", () => {
    const plan = planHouseholdSuggestions(
      [pairOf(30, 6, ["gidéon", "EXAMPLE"], ["Ri", "Example"])],
      snapshot({ contacts: [contact(GIDEON, "Gideon", "Example"), contact(RILEY, "Riley", "Example", "Ri")] })
    );
    expect(plan.summary.toFile).toBe(1);
  });

  it("stores the unordered pair once, in uuid order", () => {
    expect(canonicalPair(RILEY, GIDEON)).toEqual({ contactA: GIDEON, contactB: RILEY });
    expect(canonicalPair(GIDEON.toUpperCase(), RILEY)).toEqual({ contactA: GIDEON, contactB: RILEY });
    const plan = planHouseholdSuggestions(
      [pairOf(30, 6, ["Riley", "Example"], ["Gideon", "Example"]), pairOf(44, 6, ["Gideon", "Example"], ["Riley", "Example"])],
      snapshot()
    );
    expect(plan.suggestions).toEqual([{ contactA: GIDEON, contactB: RILEY, sourceLine: 30 }]);
    expect(plan.summary.duplicates).toBe(1);
  });

  it("skips a pair already in one household, but not one where only one has a household", () => {
    const together = planHouseholdSuggestions(
      [pairOf(12, 2, ["Esther", "Naidoo"], ["Johan", "Naidoo"])],
      snapshot({ householdAdults: [{ contactId: ESTHER, householdId: "hh1" }, { contactId: JOHAN, householdId: "hh1" }] })
    );
    expect(together.suggestions).toEqual([]);
    expect(together.summary.alreadyHousehold).toBe(1);
    const half = planHouseholdSuggestions(
      [pairOf(12, 2, ["Esther", "Naidoo"], ["Johan", "Naidoo"])],
      snapshot({ householdAdults: [{ contactId: ESTHER, householdId: "hh1" }] })
    );
    expect(half.summary.toFile).toBe(1);
  });

  it("skips a pair already suggested, whatever order or status it was filed in", () => {
    const plan = planHouseholdSuggestions(
      [pairOf(30, 6, ["Gideon", "Example"], ["Riley", "Example"])],
      snapshot({ existing: [{ contactA: RILEY, contactB: GIDEON }] })
    );
    expect(plan.suggestions).toEqual([]);
    expect(plan.summary.alreadySuggested).toBe(1);
  });

  it("skips an ambiguous name, unless only one of them is in the pair's house", () => {
    const contacts = [contact(SAM_H2, "Sam", "Dube"), contact(SAM_H3, "Sam", "Dube"), contact(LEE, "Lee", "Dube")];
    const pair = pairOf(50, 3, ["Sam", "Dube"], ["Lee", "Dube"]);
    const ambiguous = planHouseholdSuggestions([pair], snapshot({ contacts }));
    expect(ambiguous.summary).toMatchObject({ ambiguous: 1, toFile: 0 });
    const local = planHouseholdSuggestions(
      [pair],
      snapshot({ contacts, houseMembers: [{ contactId: SAM_H2, houseNumber: 2 }, { contactId: SAM_H3, houseNumber: 3 }] })
    );
    expect(local.suggestions).toEqual([{ contactA: SAM_H3, contactB: LEE, sourceLine: 50 }]);
    const both = planHouseholdSuggestions(
      [pair],
      snapshot({ contacts, houseMembers: [{ contactId: SAM_H2, houseNumber: 3 }, { contactId: SAM_H3, houseNumber: 3 }] })
    );
    expect(both.summary.ambiguous).toBe(1);
  });

  it("skips a missing person and a first name only, and never guesses", () => {
    const plan = planHouseholdSuggestions(
      [pairOf(60, 1, ["Gideon", "Example"], ["Nobody", "Here"]), pairOf(61, 1, ["Gideon", "Example"], ["Riley", ""])],
      snapshot()
    );
    expect(plan.suggestions).toEqual([]);
    expect(plan.summary).toMatchObject({ missing: 1, nameIncomplete: 1 });
  });

  it("never pairs someone with themselves", () => {
    const plan = planHouseholdSuggestions([pairOf(70, 1, ["Riley", "Example"], ["Riley", "Example"])], snapshot());
    expect(plan.summary).toMatchObject({ ambiguous: 1, toFile: 0 });
  });

  it("reports counts only, never names", () => {
    const plan = planHouseholdSuggestions(
      [pairOf(30, 6, ["Gideon", "Example"], ["Riley", "Example"]), pairOf(60, 1, ["Esther", "Naidoo"], ["Nobody", "Here"])],
      snapshot()
    );
    const text = formatSuggestionSummary(plan.summary);
    expect(text).toContain("Matched, to file as pending: 1");
    expect(text).toContain("Skipped, no matching person: 1");
    for (const name of ["Gideon", "Riley", "Esther", "Nobody", "Example", "Naidoo"]) expect(text).not.toContain(name);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });
});

describe("gate", () => {
  const prodUrl = "https://thodakhvkcodfystnkxa.supabase.co";
  const devUrl = "https://devref123.supabase.co";
  const pairs = [pairOf(30, 6, ["Gideon", "Example"], ["Riley", "Example"])];

  it("parses the same flags as the house-church import", () => {
    expect(parseSuggestionCli(["couples.csv"])).toEqual({ ok: true, csvPath: "couples.csv", apply: false, projectRef: null, approveProd: false });
    expect(parseSuggestionCli(["couples.csv", "--apply", "--project-ref=devref123", "--i-have-approval-for-prod"])).toMatchObject({
      apply: true,
      projectRef: "devref123",
      approveProd: true,
    });
    expect(parseSuggestionCli(["couples.csv", "--sheet-is-source"])).toEqual({ ok: false, error: "Unknown option --sheet-is-source." });
    expect(parseSuggestionCli([])).toEqual({ ok: false, error: "CSV path is required." });
  });

  it("a dry run never writes", async () => {
    const writer = { insertPending: vi.fn() };
    const out = await runHouseholdSuggestions({
      pairs,
      snapshot: snapshot(),
      gate: { apply: false, projectRef: null, supabaseUrl: prodUrl, approveProd: false },
      writer,
    });
    expect(out.ok && out.plan.summary.toFile).toBe(1);
    expect(writer.insertPending).not.toHaveBeenCalled();
  });

  it("--apply alone, a mismatched ref, or production without approval writes nothing", async () => {
    const writer = { insertPending: vi.fn() };
    const tries = [
      { apply: true, projectRef: null, supabaseUrl: devUrl, approveProd: false },
      { apply: true, projectRef: "otherref", supabaseUrl: devUrl, approveProd: false },
      { apply: true, projectRef: "thodakhvkcodfystnkxa", supabaseUrl: prodUrl, approveProd: false },
      { apply: true, projectRef: "devref123", supabaseUrl: undefined, approveProd: false },
    ];
    for (const gate of tries) {
      const out = await runHouseholdSuggestions({ pairs, snapshot: snapshot(), gate, writer });
      expect(out.ok).toBe(false);
    }
    expect(writer.insertPending).not.toHaveBeenCalled();
  });

  it("writes pending rows only when the ref matches", async () => {
    const writer = { insertPending: vi.fn(async () => undefined) };
    const out = await runHouseholdSuggestions({
      pairs,
      snapshot: snapshot(),
      gate: { apply: true, projectRef: "devref123", supabaseUrl: devUrl, approveProd: false },
      writer,
    });
    expect(out.ok && out.wrote).toBe(1);
    expect(writer.insertPending).toHaveBeenCalledWith({ contactA: GIDEON, contactB: RILEY, sourceLine: 30 });
  });
});
