// Parser for the FFSA OKR Google Sheet export.
//
// The sheet is block-structured, not tabular: a "Ministry Name:" row, then
// "OBJECTIVE n" rows, then "KR n.m" rows. Two things make it awkward:
//
//   1. Google's markdown export repeats a merged cell across every column it
//      spans, so a four-column-wide description arrives four times.
//   2. Every tab has its own width and its own merge spans, so the Progress
//      and Notes columns sit at a different index in each block. The index is
//      read off that block's own "Key Result #" header row, never assumed.
//
// Lives here rather than inside scripts/import-okrs.ts so it can be tested
// without a database — see sheet-parser.test.ts.

export interface ParsedKeyResult {
  label: string;
  description: string;
  progress: string;
  notes: string;
  timeline: string;
}
export interface ParsedObjective {
  position: number;
  title: string;
  keyResults: ParsedKeyResult[];
}
export interface ParsedBlock {
  line: number;
  sheetLabel: string;
  objectives: ParsedObjective[];
}

/** Strip the export's escaping and its "[merged]" repeat markers. */
export function cleanCell(raw: string): string {
  return raw
    .replace(/\\\[merged\\\]/g, "")
    .replace(/\\(.)/g, "$1")
    .trim();
}

export function rowCells(line: string): string[] | null {
  if (!line.trim().startsWith("|")) return null;
  return line
    .split("|")
    .slice(1, -1)
    .map((c) => cleanCell(c));
}

/** Google's export repeats a merged cell across every column it spans. */
export function dropRepeats(cells: string[]): string[] {
  const out: string[] = [];
  for (const c of cells) {
    if (out.length > 0 && out[out.length - 1] === c) continue;
    out.push(c);
  }
  return out;
}

export function parseSheet(text: string): { blocks: ParsedBlock[]; skipped: string[] } {
  const lines = text.split("\n");
  const blocks: ParsedBlock[] = [];
  const skipped: string[] = [];

  let block: ParsedBlock | null = null;
  let objective: ParsedObjective | null = null;
  let header: string[] | null = null;

  const columnFor = (name: string): number =>
    header ? header.findIndex((h) => h.toLowerCase() === name.toLowerCase()) : -1;

  lines.forEach((line, i) => {
    const cells = rowCells(line);
    if (!cells) return;
    if (cells.every((c) => c === "" || c === ":-:")) return; // spacer / alignment row

    const first = cells[0];

    if (first.startsWith("Ministry Name")) {
      block = {
        line: i,
        sheetLabel: cells.slice(1).find((c) => c !== "") ?? "",
        objectives: [],
      };
      blocks.push(block);
      objective = null;
      header = null;
      return;
    }

    if (/^objective\s*\d*/i.test(first)) {
      if (!block) {
        skipped.push(`line ${i}: objective before any ministry heading — "${first}"`);
        return;
      }
      objective = {
        position: block.objectives.length + 1,
        title: cells.slice(1).find((c) => c !== "") ?? "",
        keyResults: [],
      };
      block.objectives.push(objective);
      return;
    }

    if (first.startsWith("Key Result")) {
      header = cells;
      return;
    }

    if (/^KR\s*\d/i.test(first)) {
      if (!objective) {
        skipped.push(`line ${i}: key result outside any objective — "${first}"`);
        return;
      }
      const collapsed = dropRepeats(cells);
      const description = collapsed.slice(1).find((c) => c !== "") ?? "";
      const at = (name: string) => {
        const idx = columnFor(name);
        return idx >= 0 && idx < cells.length ? cells[idx] : "";
      };
      objective.keyResults.push({
        label: first,
        description,
        progress: at("Progress"),
        notes: at("Notes"),
        timeline: at("Timeline"),
      });
      return;
    }

    if (first !== "") skipped.push(`line ${i}: unrecognised row — "${first.slice(0, 70)}"`);
  });

  return { blocks, skipped };
}

/* ── Status mapping ──────────────────────────────────── */

export const STATUS_MAP: Record<string, string> = {
  "": "not_started",
  false: "not_started",
  "not started": "not_started",
  "in progress": "in_progress",
  "in progress / wrestling": "in_progress",
  wrestling: "in_progress",
  "moving foward": "moving_forward", // the sheet's own spelling, kept on purpose
  "moving forward": "moving_forward",
  "in-prgress": "in_progress", // a typo in the sheet; there is only one
  stuck: "stuck",
  blocked: "stuck",
  "on hold": "stuck",
  // No enum value means "attempted and missed". `stuck` is the closest, and
  // LOSSY_STATUS_NOTES below keeps the original word on the seeded check-in so
  // the distinction is not silently thrown away.
  failed: "stuck",
  // A stray header cell that landed in a Progress column.
  notes: "not_started",
  complete: "complete",
  completed: "complete",
  done: "complete",
};

/**
 * Sheet words whose mapping loses meaning. The importer prepends the note to
 * the seeded check-in's comment rather than letting the nuance disappear.
 */
export const LOSSY_STATUS_NOTES: Record<string, string> = {
  failed: 'Marked "Failed" in the original sheet — recorded here as stuck.',
};

export function lossyStatusNote(raw: string): string | null {
  return LOSSY_STATUS_NOTES[raw.trim().toLowerCase()] ?? null;
}

export function mapStatus(raw: string): string | null {
  return STATUS_MAP[raw.trim().toLowerCase()] ?? null;
}

