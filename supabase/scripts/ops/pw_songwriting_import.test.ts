import { describe, expect, it } from "vitest";
import {
  buildPlan,
  cellText,
  parseCsv,
  parseLanguages,
  parseMonth,
  splitTrainers,
  toSql,
  type ImportConfig,
} from "./pw_songwriting_import";

// Made-up rows only. Real sheet rows and names stay off the repo.
const CONFIG: ImportConfig = {
  nations: [
    { name: "Northland", slug: "northland", continent: "europe", status: "active" },
    { name: "Southland", slug: "southland", continent: "africa", status: "active" },
    { name: "Maybeland", slug: "maybeland", continent: "asia", status: "tentative" },
  ],
  locationNations: {
    "town a": "southland",
    "north city": "northland",
    "town a/maybeland": "maybeland",
  },
  nameAliases: { al: "Alex", alex: "Alex", bea: "Beatrix" },
  languageAliases: { nl: "Northlandic" },
};

const TAB_A = [
  "Date,,Location,Trainee,Trainer,No. Trained,No. Songs,No Post-Workshop Songs (known)",
  "August,1,Town A ,Group One,Al/Bea,10,3,1,Some note",
  ",2,North City,,\"Multiple: Cy, Al\",5,2,Lots maybe",
  "Sept,1,Mystery Place,Home group,Dee?,,,,Potentials only",
  ",3,Town A/Maybeland,Visitor,Alex,1,0",
  ",,,,,,,",
  "Running Total,,4,,3,16,5,1",
  "Dec,1,Town A,After total,Al,9,9,9",
].join("\n");

const TAB_B = [
  "Date,,Location,Trainee,Trainer,No. Trained,No. Songs,No Post-Workshop Songs (known),Notes",
  "Feb,1,North City,Team,Bea,?,1,,\"LANGUAGES: NL, Southish (first ever)\",Ps 1",
  ",,North City,Team,Bea,4,2",
  "Aug.,,Unknown Town,Team,Bea,2,1",
].join("\n");

describe("pw songwriting import transform", () => {
  const plan = buildPlan({ "2025": TAB_A, "2026": TAB_B, "ALL STATS": "ignored" }, CONFIG);

  it("parses quoted CSV cells", () => {
    expect(parseCsv('a,"b, c","d ""e"""\n1')).toEqual([["a", "b, c", 'd "e"'], ["1"]]);
  });

  it("treats a lone ? as null and trims", () => {
    expect(cellText(" ? ")).toBeNull();
    expect(cellText("  Town   A ")).toBe("Town A");
  });

  it("reads month names and abbreviations", () => {
    expect(parseMonth("Sept")).toBe(9);
    expect(parseMonth("Aug.")).toBe(8);
    expect(parseMonth("Smarch")).toBeNull();
  });

  it("splits trainers on / and commas, dropping a Multiple: prefix", () => {
    expect(splitTrainers("Al/ Bea")).toEqual(["Al", "Bea"]);
    expect(splitTrainers("Multiple: Cy, Al")).toEqual(["Cy", "Al"]);
  });

  it("reads languages from notes through the alias map", () => {
    expect(parseLanguages("LANGUAGES: NL, Southish (first ever)", { nl: "Northlandic" })).toEqual([
      "Northlandic",
      "Southish",
    ]);
  });

  it("drops column B, fills months down and stops at Running Total", () => {
    expect(plan.trainings.map((t) => [t.year, t.month, t.location_text])).toEqual([
      [2025, 8, "Town A"],
      [2025, 8, "North City"],
      [2025, 9, "Town A/Maybeland"],
      [2026, 2, "North City"],
      [2026, 2, "North City"],
      [2026, 8, "Unknown Town"],
    ]);
  });

  it("skips rows with no counts and says why", () => {
    expect(plan.skipped).toEqual([
      expect.objectContaining({ tab: "2025", location: "Mystery Place", reason: expect.stringMatching(/no counts/) }),
    ]);
  });

  it("normalises names and keeps one facilitator per name", () => {
    expect(plan.trainings[0].facilitators).toEqual(["Alex", "Beatrix"]);
    expect(plan.trainings[1].facilitators).toEqual(["Cy", "Alex"]);
    expect(plan.trainings[2].facilitators).toEqual(["Alex"]);
    expect(plan.nameNormalisations).toEqual({ Al: "Alex", Bea: "Beatrix" });
  });

  it("maps locations to nations and flags unmapped ones", () => {
    expect(plan.trainings.map((t) => t.nation_slug)).toEqual([
      "southland",
      "northland",
      "maybeland",
      "northland",
      "northland",
      null,
    ]);
    expect(plan.ambiguities).toContainEqual(expect.objectContaining({ field: "location", raw: "Unknown Town" }));
  });

  it("stores text in a count column as null and keeps it in notes", () => {
    const row = plan.trainings[1];
    expect(row.songs_post).toBeNull();
    expect(row.notes).toContain("Lots maybe");
    expect(plan.ambiguities).toContainEqual(expect.objectContaining({ field: "songs_post", raw: "Lots maybe" }));
  });

  it("keeps ? counts as null, joins extra columns into notes, and reads languages", () => {
    const row = plan.trainings[3];
    expect(row.people_trained).toBeNull();
    expect(row.notes).toBe("LANGUAGES: NL, Southish (first ever) — Ps 1");
    expect(row.languages).toEqual(["Northlandic", "Southish"]);
  });

  it("gives every training a stable, unique import key", () => {
    const keys = plan.trainings.map((t) => t.import_key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[3]).toBe("2026-02|north-city|team|beatrix");
    expect(keys[4]).toBe("2026-02|north-city|team|beatrix#2");
    expect(buildPlan({ "2025": TAB_A, "2026": TAB_B }, CONFIG).trainings.map((t) => t.import_key)).toEqual(keys);
  });

  it("emits idempotent SQL keyed on natural keys", () => {
    const sql = toSql(plan);
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
    expect(sql).toContain("ON CONFLICT (slug) DO UPDATE");
    expect(sql).toContain("ON CONFLICT (import_key) DO UPDATE");
    expect(sql).toContain("ON CONFLICT (training_id, display_name) DO NOTHING");
    expect(sql).toContain("IS DISTINCT FROM");
    expect(sql).toContain("WHERE t.source = 'imported'");
    expect(sql).not.toMatch(/supabase\.co|service_role|DELETE FROM/i);
  });

  it("escapes quotes in values", () => {
    const quoted = buildPlan(
      { "2025": "h\nMay,1,Town A,O'Brien's group,Al,1,1" },
      CONFIG
    );
    expect(toSql(quoted)).toContain("'O''Brien''s group'");
  });

  it("rejects a location mapped to a nation that is not configured", () => {
    expect(() =>
      buildPlan({ "2025": "h\nMay,1,Town A,G,Al,1,1" }, { ...CONFIG, locationNations: { "town a": "nowhere" } })
    ).toThrow(/unknown nation slug/);
  });
});
