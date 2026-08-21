import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

import { cleanCell, dropRepeats, mapStatus, parseSheet } from "./sheet-parser";

const SHEET = resolve(__dirname, "../../../scripts/data/okrs-sheet.md");

describe("cleanCell", () => {
  it("drops the export's merged-cell marker", () => {
    expect(cleanCell(" \\[merged\\] Lead 12 moments ")).toBe("Lead 12 moments");
  });

  it("unescapes the export's backslashes", () => {
    expect(cleanCell("Key Result \\#")).toBe("Key Result #");
    expect(cleanCell("Train 180+ \\*In-house")).toBe("Train 180+ *In-house");
  });
});

describe("dropRepeats", () => {
  it("collapses a merged cell repeated across the columns it spans", () => {
    expect(dropRepeats(["KR 1.1", "Lead 12", "Lead 12", "Lead 12", "Stuck"])).toEqual([
      "KR 1.1",
      "Lead 12",
      "Stuck",
    ]);
  });

  it("keeps identical values that are not adjacent", () => {
    expect(dropRepeats(["a", "b", "a"])).toEqual(["a", "b", "a"]);
  });
});

describe("mapStatus", () => {
  it("accepts the sheet's own misspelling", () => {
    // "Moving Foward" appears 99 times in the real sheet. Correcting the
    // spelling in the source is not an option — this has to match.
    expect(mapStatus("Moving Foward")).toBe("moving_forward");
    expect(mapStatus("Moving Forward")).toBe("moving_forward");
  });

  it("treats a blank and a stray FALSE as not started", () => {
    expect(mapStatus("")).toBe("not_started");
    expect(mapStatus("FALSE")).toBe("not_started");
  });

  it("returns null for anything unrecognised, so the import can abort", () => {
    expect(mapStatus("Its been GLORY")).toBeNull();
  });
});

describe("parseSheet", () => {
  const sheet = readFileSync(SHEET, "utf-8");
  const { blocks, skipped } = parseSheet(sheet);

  it("finds every ministry block", () => {
    expect(blocks).toHaveLength(27);
  });

  it("reads the counts the sheet actually contains", () => {
    const objectives = blocks.reduce((n, b) => n + b.objectives.length, 0);
    const keyResults = blocks.reduce(
      (n, b) => n + b.objectives.reduce((m, o) => m + o.keyResults.length, 0),
      0
    );
    expect(objectives).toBe(121);
    expect(keyResults).toBe(510);
  });

  it("un-merges a description rather than repeating it", () => {
    const base = blocks[0];
    expect(base.objectives[0].keyResults[0]).toMatchObject({
      label: "KR 1.1",
      description: "Lead 12 base-wide moments of consecration",
    });
  });

  it("reads Progress from each block's own header row, not a fixed column", () => {
    // The base-wide block puts Progress at index 5; Prayer & Worship's tab is
    // 20 columns wide and puts it elsewhere. Both must land in .progress.
    const base = blocks[0];
    expect(base.objectives[0].keyResults[0].progress).toBe("Moving Foward");
    expect(base.objectives[0].keyResults[2].progress).toBe("Stuck");
  });

  it("carries the Notes cell across", () => {
    const base = blocks[0];
    expect(base.objectives[0].keyResults[2].notes).toContain("stats spreadsheet");
  });

  it("recognises every status word in the sheet, or names the ones it cannot", () => {
    const unknown = new Set<string>();
    for (const b of blocks) {
      for (const o of b.objectives) {
        for (const kr of o.keyResults) {
          if (mapStatus(kr.progress) === null) unknown.add(kr.progress);
        }
      }
    }
    // If this fails, the listed values need adding to STATUS_MAP before any
    // import — the importer aborts on them rather than defaulting to
    // "not started" and losing real progress.
    expect([...unknown]).toEqual([]);
  });

  it("reports the rows it did not understand instead of dropping them silently", () => {
    // Stray notes, checklists and the "old 2026" marker in the sheet.
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped.some((s) => s.includes("old 2026"))).toBe(true);
  });
});
