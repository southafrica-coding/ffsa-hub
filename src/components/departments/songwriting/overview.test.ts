import { describe, expect, it } from "vitest";
import type { PwContinent, PwNation, PwSongwritingTraining } from "@/lib/departments/db.types";
import { computeOverview, heroBlurb, openLeadCount, reachedPercent } from "./overview";
import { nationCode, nationLanguages, summariseNations, trainedText } from "./nations";
import { applyFilter, filterChips, groupByMonth, trainingTitle } from "./trainings";
import { logSongHref, postSongRows, postSongSummary } from "./followup";

// A reduced test fixture that follows the same rules as the Op. Dandelion
// sheet and lands on the overview mockup's numbers. Not real people; never
// shipped as runtime data.

const STAMP = "2026-11-26T08:00:00.000Z";

function nation(slug: string, name: string, continent: PwContinent, status: PwNation["status"] = "active"): PwNation {
  return { id: `n-${slug}`, name, slug, continent, status, notes: null, iso_code: null, languages: [], created_at: STAMP, updated_at: STAMP };
}

let seq = 0;
function training(
  year: number,
  month: number,
  nationSlug: string,
  counts: { trained: number | null; workshop: number | null; post: number | null },
  extra: Partial<PwSongwritingTraining> = {}
): PwSongwritingTraining {
  seq += 1;
  return {
    id: `t-${seq}`,
    year,
    month,
    training_date: null,
    location_text: "Potch",
    nation_id: `n-${nationSlug}`,
    audience_label: `Group ${seq}`,
    people_trained: counts.trained,
    songs_workshop: counts.workshop,
    songs_post: counts.post,
    notes: null,
    languages: [],
    status: "completed",
    source: "imported",
    import_key: `k-${seq}`,
    created_by: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...extra,
  };
}

// 2025 new: 3 continents (Africa, Europe, North America). 2026 new: 4 (Asia, Africa, South America, Europe).
const NATIONS: PwNation[] = [
  nation("south-africa", "South Africa", "africa"),
  nation("tanzania", "Tanzania", "africa"),
  nation("ivory-coast", "Ivory Coast", "africa"),
  nation("england", "England", "europe"),
  nation("madagascar", "Madagascar", "africa"),
  nation("canada", "Canada", "north_america"),
  nation("netherlands", "Netherlands", "europe"),
  nation("indonesia", "Indonesia", "asia"),
  nation("burundi", "Burundi", "africa"),
  nation("kenya", "Kenya", "africa"),
  nation("nepal", "Nepal", "asia"),
  nation("paraguay", "Paraguay", "south_america"),
  nation("italy", "Italy", "europe", "tentative"),
];

function fixture(): PwSongwritingTraining[] {
  seq = 0;
  const rows: PwSongwritingTraining[] = [];
  // 2025: 15 trainings, 132 trained, 41 workshop songs, 6 after, 7 new nations.
  const first2025 = ["south-africa", "tanzania", "ivory-coast", "england", "madagascar", "canada", "netherlands"];
  first2025.forEach((slug, i) => rows.push(training(2025, 8 + (i % 5), slug, { trained: 10, workshop: 3, post: i < 6 ? 1 : 0 })));
  for (let i = 0; i < 8; i++) {
    rows.push(training(2025, 12, "south-africa", { trained: i < 7 ? 8 : 6, workshop: i < 6 ? 3 : 1, post: 0 }));
  }
  // 2026: 19 trainings, 230 trained (Burundi unknown), 98 workshop, 14 after (one unknown), 6 new nations.
  const first2026 = ["indonesia", "burundi", "kenya", "nepal", "paraguay", "italy"];
  first2026.forEach((slug, i) =>
    rows.push(
      training(2026, 3 + i, slug, {
        trained: slug === "burundi" ? null : slug === "italy" ? 26 : 12,
        workshop: 5,
        post: 1,
      })
    )
  );
  for (let i = 0; i < 13; i++) {
    rows.push(
      training(2026, 10, "south-africa", {
        trained: 12,
        workshop: i < 12 ? 5 : 8,
        post: i < 8 ? 1 : i === 12 ? null : 0,
      })
    );
  }
  // Drafts never count, even in a new nation and year.
  rows.push(training(2027, 1, "south-africa", { trained: 99, workshop: 99, post: 99 }, { status: "draft" }));
  return rows;
}

describe("computeOverview", () => {
  const totals = computeOverview({
    nations: NATIONS,
    trainings: fixture(),
    librarySongs: 0,
    openLeads: openLeadCount([
      { status: "to_contact" },
      { status: "to_contact" },
      { status: "waiting" },
      { status: "waiting" },
      { status: "new" },
      { status: "connected" },
      { status: "closed" },
    ]),
  });

  it("reproduces the mockup's year table", () => {
    expect(totals.years).toEqual([
      { year: 2025, trainings: 15, trained: 132, songsWorkshop: 41, songsAfter: 6, newNations: 7, continents: 3 },
      { year: 2026, trainings: 19, trained: 230, songsWorkshop: 98, songsAfter: 14, newNations: 6, continents: 4 },
    ]);
    expect(totals.total).toEqual({
      trainings: 34,
      trained: 362,
      songsWorkshop: 139,
      songsAfter: 20,
      newNations: 13,
      continents: null,
    });
  });

  it("gives the KPIs: 13/195, about 159 songs, 0 in the library, 5 leads", () => {
    expect(totals.nationsReached).toBe(13);
    expect(reachedPercent(totals.nationsReached)).toBe("6.7%");
    expect(totals.songsApprox).toBe(159);
    expect(totals.librarySongs).toBe(0);
    expect(totals.openLeads).toBe(5);
    expect(totals.span).toEqual({ from: { year: 2025, month: 8 }, to: { year: 2026, month: 10 } });
  });

  it("counts tentative nations in the total and names them separately", () => {
    expect(totals.tentativeNations.map((n) => n.name)).toEqual(["Italy"]);
    expect(heroBlurb(totals)).toBe("Includes Italy, which is tentative. 7 new nations in 2025, 6 in 2026.");
  });

  it("adds unknown counts as 0", () => {
    const one = computeOverview({
      nations: NATIONS,
      trainings: [training(2026, 5, "burundi", { trained: null, workshop: null, post: null })],
    });
    expect(one.total).toMatchObject({ trainings: 1, trained: 0, songsWorkshop: 0, songsAfter: 0, newNations: 1 });
    expect(one.songsApprox).toBe(0);
  });

  it("counts a nation as new only in the year of its first completed training", () => {
    const rows = [
      training(2026, 2, "kenya", { trained: 1, workshop: 1, post: 0 }),
      training(2025, 11, "kenya", { trained: 1, workshop: 1, post: 0 }),
      training(2025, 9, "kenya", { trained: 1, workshop: 1, post: 0 }, { status: "draft" }),
      training(2026, 4, "nepal", { trained: 1, workshop: 1, post: 0 }),
    ];
    const result = computeOverview({ nations: NATIONS, trainings: rows });
    expect(result.years.map((y) => [y.year, y.newNations, y.continents])).toEqual([
      [2025, 1, 1],
      [2026, 1, 1],
    ]);
  });

  it("is empty and safe with no data", () => {
    const empty = computeOverview({ nations: [], trainings: [] });
    expect(empty.years).toEqual([]);
    expect(empty.nationsReached).toBe(0);
    expect(empty.latest).toBeNull();
    expect(heroBlurb(empty)).toBe("");
  });
});

describe("nations, trainings and follow-up helpers", () => {
  const rows = fixture();
  const byId = new Map(NATIONS.map((n) => [n.id, n]));

  it("summarises nations with unknown counts and derived languages", () => {
    const withLangs = rows.map((t) => (t.nation_id === "n-indonesia" ? { ...t, languages: ["Indo", "wana", "Wana"] } : t));
    const summaries = summariseNations(NATIONS, withLangs);
    expect(summaries[0].nation.slug).toBe("south-africa");
    expect(summaries[summaries.length - 1].nation.slug).toBe("italy");
    const burundi = summaries.find((s) => s.nation.slug === "burundi")!;
    expect(trainedText(burundi)).toBe("?");
    expect(summaries.find((s) => s.nation.slug === "indonesia")!.languages).toEqual(["Indo", "wana"]);
    expect(nationLanguages([])).toEqual([]);
    expect(nationCode(NATIONS[0])).toBe("ZA");
    expect(nationCode({ slug: "atlantis", name: "Atlantis" })).toBe("AT");
  });

  it("never titles a card with a person's name", () => {
    expect(trainingTitle({ audience_label: null })).toBe("1:1 training");
    expect(trainingTitle({ audience_label: "1:1" })).toBe("1:1 training");
    expect(trainingTitle({ audience_label: "1:1 training · visitor from Italy" })).toBe("1:1 training · visitor from Italy");
    expect(trainingTitle({ audience_label: "SBS" })).toBe("SBS");
  });

  it("builds the filter chips and month groups newest first", () => {
    const done = rows.filter((t) => t.status === "completed");
    const chips = filterChips(done, byId);
    expect(chips.map((c) => `${c.label} · ${c.count}`)).toEqual(["All · 34", "2026 · 19", "2025 · 15", "Outside SA · 12"]);
    expect(applyFilter(done, { kind: "year", year: 2025 }, byId)).toHaveLength(15);
    const groups = groupByMonth(done);
    expect(groups[0].label).toBe("Oct 2026");
    expect(groups[groups.length - 1].label).toBe("Aug 2025");
  });

  it("lists post-workshop songs, including unknown counts", () => {
    const list = postSongRows(rows, { "t-1": 1 });
    expect(list.every((r) => r.known == null || r.known > 0)).toBe(true);
    expect(list.some((r) => r.known == null)).toBe(true);
    expect(postSongSummary(list)).toEqual({ known: 20, logged: 1 });
    expect(logSongHref("/song-library/upload", "t-1")).toBe("/song-library/upload?source_training_id=t-1");
  });
});
