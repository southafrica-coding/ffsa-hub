/**
 * Pure planning for couple suggestions (migration 398, not applied).
 *
 * scripts/missio-suggest-households.ts is a thin wrapper: it reads the
 * database, calls this module, and writes pending rows only when --apply
 * passes the same project-ref gate as the house-church import. A dry run
 * never calls the writer, and the report is counts only (no names).
 *
 * Input is the house church sheet as the import parsed it: one row per
 * person, with the two halves of an "X & Y" cell as kind = couple_split on
 * the same source_line. Only those pairs are used. Surname-only family
 * rows, two leaders of one house, and contacts.marital_status are never a
 * source.
 *
 * Matching is conservative, with the import's name rules: first + last
 * must match exactly one Missio person; when several share the name, the
 * one in the pair's house may be used if it is the only one there. A
 * first name alone, no match, or several matches is skipped. Nothing here
 * creates a household.
 */

import {
  checkImportWriteGate,
  exactContactIds,
  normalizePersonName,
  parseCsvTable,
  type ContactName,
} from "@/lib/missio/house-church-import";

export const SUGGESTION_SOURCE = "house_church_sheet" as const;

/** Columns the CSV must have. Any other columns (raw_name, role, note…) are ignored. */
export const COUPLE_CSV_COLUMNS = ["source_line", "house", "first", "last", "kind", "part_index"] as const;

export type CoupleCsvRow = {
  sourceLine: number;
  houseNumber: number;
  first: string;
  last: string;
  kind: string;
  partIndex: number;
};

export type CouplePair = {
  sourceLine: number;
  houseNumber: number;
  people: [Pick<CoupleCsvRow, "first" | "last">, Pick<CoupleCsvRow, "first" | "last">];
};

export type SuggestionSnapshot = {
  /** Contacts with a Missio org_people row: the only match pool. */
  contacts: ContactName[];
  /** Open house memberships in Missio, by house number. */
  houseMembers: Array<{ contactId: string; houseNumber: number }>;
  /** Adults already in a Missio household. */
  householdAdults: Array<{ contactId: string; householdId: string }>;
  /** Every suggestion already filed, whatever its status. */
  existing: Array<{ contactA: string; contactB: string }>;
};

export type PlannedSuggestion = { contactA: string; contactB: string; sourceLine: number };

export type SuggestionSummary = {
  pairsIn: number;
  /** Rows that weren't a complete two-person couple on one line. */
  badPairs: number;
  toFile: number;
  alreadyHousehold: number;
  alreadySuggested: number;
  ambiguous: number;
  missing: number;
  /** One half has a first name only. */
  nameIncomplete: number;
  /** The same pair twice in the CSV. */
  duplicates: number;
};

export type SuggestionPlan = { suggestions: PlannedSuggestion[]; summary: SuggestionSummary };

export type SuggestionWriter = {
  /** Insert a pending row; an existing row for the pair is left as it is. */
  insertPending(row: PlannedSuggestion): Promise<void>;
};

// ────────────────────────────────────────────────────────────
// CSV
// ────────────────────────────────────────────────────────────

function wholeNumber(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

/** Parse the operator's CSV. Rows that aren't couple_split are dropped here. */
export function parseCoupleCsv(text: string): { ok: true; rows: CoupleCsvRow[]; otherRows: number } | { ok: false; error: string } {
  let table: string[][];
  try {
    table = parseCsvTable(text);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The CSV could not be parsed." };
  }
  if (table.length === 0) return { ok: false, error: "The CSV is empty." };
  const header = table[0]!.map((cell) => cell.trim());
  const missing = COUPLE_CSV_COLUMNS.find((column) => !header.includes(column));
  if (missing) return { ok: false, error: `The CSV is missing column ${missing}.` };
  const index = new Map(header.map((column, position) => [column, position]));
  const rows: CoupleCsvRow[] = [];
  let otherRows = 0;
  for (let i = 1; i < table.length; i++) {
    const cells = table[i]!;
    const lineNo = i + 1;
    const cell = (column: string) => (cells[index.get(column) ?? -1] ?? "").trim();
    const kind = cell("kind").toLowerCase();
    if (kind !== "couple_split") {
      otherRows += 1;
      continue;
    }
    const sourceLine = wholeNumber(cell("source_line"));
    const houseNumber = wholeNumber(cell("house"));
    const partIndex = wholeNumber(cell("part_index"));
    if (sourceLine === null || sourceLine < 1) return { ok: false, error: `Row ${lineNo} has a bad source_line.` };
    if (houseNumber === null || houseNumber < 1) return { ok: false, error: `Row ${lineNo} has a bad house number.` };
    if (partIndex === null) return { ok: false, error: `Row ${lineNo} has a bad part_index.` };
    rows.push({ sourceLine, houseNumber, first: cell("first"), last: cell("last"), kind, partIndex });
  }
  return { ok: true, rows, otherRows };
}

/** Group couple_split rows into pairs by source_line. A line without exactly two distinct parts is bad. */
export function groupCouplePairs(rows: CoupleCsvRow[]): { pairs: CouplePair[]; badPairs: number } {
  const byLine = new Map<number, CoupleCsvRow[]>();
  for (const row of rows) byLine.set(row.sourceLine, [...(byLine.get(row.sourceLine) ?? []), row]);
  const pairs: CouplePair[] = [];
  let badPairs = 0;
  for (const [sourceLine, parts] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = [...parts].sort((a, b) => a.partIndex - b.partIndex);
    const houses = new Set(sorted.map((part) => part.houseNumber));
    if (sorted.length !== 2 || sorted[0]!.partIndex === sorted[1]!.partIndex || houses.size !== 1) {
      badPairs += 1;
      continue;
    }
    pairs.push({
      sourceLine,
      houseNumber: sorted[0]!.houseNumber,
      people: [
        { first: sorted[0]!.first, last: sorted[0]!.last },
        { first: sorted[1]!.first, last: sorted[1]!.last },
      ],
    });
  }
  return { pairs, badPairs };
}

// ────────────────────────────────────────────────────────────
// Matching
// ────────────────────────────────────────────────────────────

export type PartMatch = { ok: true; contactId: string } | { ok: false; reason: "incomplete" | "missing" | "ambiguous" };

/**
 * One half of a couple: exact first + last in the Missio pool. If several
 * people share that name, the only one in the pair's house; otherwise skip.
 */
export function matchCouplePart(
  part: Pick<CoupleCsvRow, "first" | "last">,
  houseNumber: number,
  contacts: ContactName[],
  houseMembers: SuggestionSnapshot["houseMembers"]
): PartMatch {
  if (!normalizePersonName(part.first) || !normalizePersonName(part.last)) return { ok: false, reason: "incomplete" };
  const exact = exactContactIds(contacts, part.first, part.last);
  if (exact.length === 1) return { ok: true, contactId: exact[0]! };
  if (exact.length === 0) return { ok: false, reason: "missing" };
  const inHouse = new Set(houseMembers.filter((row) => row.houseNumber === houseNumber).map((row) => row.contactId));
  const local = exact.filter((id) => inHouse.has(id));
  if (local.length === 1) return { ok: true, contactId: local[0]! };
  return { ok: false, reason: "ambiguous" };
}

/** Postgres orders uuids bytewise, which is lowercase-hex string order. */
export function canonicalPair(x: string, y: string): { contactA: string; contactB: string } {
  const a = x.toLowerCase();
  const b = y.toLowerCase();
  return a < b ? { contactA: a, contactB: b } : { contactA: b, contactB: a };
}

const pairKey = (pair: { contactA: string; contactB: string }) => `${pair.contactA}|${pair.contactB}`;

export function planHouseholdSuggestions(pairs: CouplePair[], snapshot: SuggestionSnapshot, badPairs = 0): SuggestionPlan {
  const summary: SuggestionSummary = {
    pairsIn: pairs.length + badPairs,
    badPairs,
    toFile: 0,
    alreadyHousehold: 0,
    alreadySuggested: 0,
    ambiguous: 0,
    missing: 0,
    nameIncomplete: 0,
    duplicates: 0,
  };
  const householdOf = new Map(snapshot.householdAdults.map((row) => [row.contactId.toLowerCase(), row.householdId]));
  const existing = new Set(snapshot.existing.map((row) => pairKey(canonicalPair(row.contactA, row.contactB))));
  const planned = new Set<string>();
  const suggestions: PlannedSuggestion[] = [];

  for (const pair of pairs) {
    const matches = pair.people.map((part) => matchCouplePart(part, pair.houseNumber, snapshot.contacts, snapshot.houseMembers));
    const failed = matches.filter((match): match is Extract<PartMatch, { ok: false }> => !match.ok);
    if (failed.some((match) => match.reason === "incomplete")) {
      summary.nameIncomplete += 1;
      continue;
    }
    if (failed.some((match) => match.reason === "ambiguous")) {
      summary.ambiguous += 1;
      continue;
    }
    if (failed.length > 0) {
      summary.missing += 1;
      continue;
    }
    const [a, b] = matches as Array<Extract<PartMatch, { ok: true }>>;
    if (a!.contactId === b!.contactId) {
      summary.ambiguous += 1;
      continue;
    }
    const pairIds = canonicalPair(a!.contactId, b!.contactId);
    const key = pairKey(pairIds);
    if (planned.has(key)) {
      summary.duplicates += 1;
      continue;
    }
    const ha = householdOf.get(pairIds.contactA);
    if (ha && ha === householdOf.get(pairIds.contactB)) {
      summary.alreadyHousehold += 1;
      continue;
    }
    if (existing.has(key)) {
      summary.alreadySuggested += 1;
      continue;
    }
    planned.add(key);
    suggestions.push({ ...pairIds, sourceLine: pair.sourceLine });
  }
  summary.toFile = suggestions.length;
  return { suggestions, summary };
}

// ────────────────────────────────────────────────────────────
// CLI, gate, run
// ────────────────────────────────────────────────────────────

export type SuggestionCli = { csvPath: string; apply: boolean; projectRef: string | null; approveProd: boolean };

export function parseSuggestionCli(argv: string[]): ({ ok: true } & SuggestionCli) | { ok: false; error: string } {
  let csvPath: string | null = null;
  let apply = false;
  let projectRef: string | null = null;
  let approveProd = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--i-have-approval-for-prod") {
      approveProd = true;
      continue;
    }
    if (arg === "--project-ref") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) return { ok: false, error: "--project-ref needs a value." };
      projectRef = value;
      continue;
    }
    if (arg.startsWith("--project-ref=")) {
      const value = arg.slice("--project-ref=".length).trim();
      if (!value) return { ok: false, error: "--project-ref needs a value." };
      projectRef = value;
      continue;
    }
    if (arg.startsWith("--")) return { ok: false, error: `Unknown option ${arg}.` };
    if (csvPath) return { ok: false, error: "Pass one CSV path." };
    csvPath = arg;
  }
  if (!csvPath) return { ok: false, error: "CSV path is required." };
  return { ok: true, csvPath, apply, projectRef, approveProd };
}

/** Counts only. Never names, emails or phones. */
export function formatSuggestionSummary(summary: SuggestionSummary): string {
  return [
    `Couple pairs in the CSV: ${summary.pairsIn}`,
    `  not a complete pair on one line: ${summary.badPairs}`,
    `Matched, to file as pending: ${summary.toFile}`,
    `Skipped, already one household: ${summary.alreadyHousehold}`,
    `Skipped, already suggested: ${summary.alreadySuggested}`,
    `Skipped, ambiguous name: ${summary.ambiguous}`,
    `Skipped, no matching person: ${summary.missing}`,
    `Skipped, first name only: ${summary.nameIncomplete}`,
    `Skipped, same pair twice in the CSV: ${summary.duplicates}`,
  ].join("\n");
}

/**
 * Plan, and write only when the gate passes. Checks the gate itself too,
 * so a caller can't reach the writer with --apply alone.
 */
export async function runHouseholdSuggestions(input: {
  pairs: CouplePair[];
  badPairs?: number;
  snapshot: SuggestionSnapshot;
  gate: { apply: boolean; projectRef: string | null; supabaseUrl: string | undefined; approveProd: boolean };
  writer: SuggestionWriter;
}): Promise<{ ok: true; plan: SuggestionPlan; wrote: number } | { ok: false; error: string }> {
  const gate = checkImportWriteGate(input.gate);
  if (!gate.ok) return gate;
  const plan = planHouseholdSuggestions(input.pairs, input.snapshot, input.badPairs ?? 0);
  if (!input.gate.apply) return { ok: true, plan, wrote: 0 };
  let wrote = 0;
  for (const row of plan.suggestions) {
    await input.writer.insertPending(row);
    wrote += 1;
  }
  return { ok: true, plan, wrote };
}
