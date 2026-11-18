/**
 * Pure planning for the house-church sheet import.
 *
 * The script in scripts/missio-import-house-churches.ts is a thin wrapper:
 * it reads the database, calls this module, and writes only when --apply
 * passes the project-ref gate. Dry-run never calls the writer.
 *
 * Auto-link is only for kind person or couple_split when both first and last
 * are present and exactly one contact matches. Everything else is a review
 * row. A review row whose status is not pending is never overwritten.
 * An active membership with a different role is reported and left as it is.
 */

import type { HouseChurchRole } from "@/lib/missio/types";

export type { HouseChurchRole };

export const MISSIO_PROD_PROJECT_REF = "thodakhvkcodfystnkxa";

export const HOUSE_CHURCH_CSV_COLUMNS = [
  "source_line",
  "house",
  "role",
  "raw_name",
  "first",
  "last",
  "people_count_on_row",
  "kind",
  "note",
  "part_index",
  "parts_in_row",
] as const;

export const IMPORT_MATCH_TYPES = ["none", "multiple", "family_label", "first_only", "partial"] as const;

export type ImportMatchType = (typeof IMPORT_MATCH_TYPES)[number];

export type ImportReviewStatus = "pending" | "matched" | "new" | "skipped";

export type CsvHouseRow = {
  sourceLine: number;
  houseNumber: number;
  role: HouseChurchRole;
  rawName: string;
  first: string;
  last: string;
  peopleCountOnRow: number;
  kind: string;
  note: string;
  partIndex: number;
  partsInRow: number;
};

export type ContactName = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  preferredName: string | null;
};

export type HouseRef = {
  id: string;
  orgId: string;
  number: number;
};

export type ExistingMember = {
  houseChurchId: string;
  contactId: string;
  role: HouseChurchRole;
  /** Missing means the row has already started. */
  startedAt?: string | null;
  endedAt: string | null;
};

/** Open row: the partial unique index WHERE ended_at IS NULL. */
export function membershipIsOpen(row: { endedAt?: string | null }): boolean {
  return row.endedAt == null || row.endedAt === "";
}

/**
 * Current membership, matching missio_member_status:
 * started_at <= today AND (ended_at IS NULL OR ended_at > today).
 */
export function membershipIsCurrent(
  row: { startedAt?: string | null; endedAt?: string | null },
  today = new Date().toISOString().slice(0, 10)
): boolean {
  const started = (row.startedAt ?? "0001-01-01").slice(0, 10);
  if (!started || started > today) return false;
  if (membershipIsOpen(row)) return true;
  return (row.endedAt ?? "").slice(0, 10) > today;
}

/** A new open row is blocked by an open row or by a current membership. */
export function membershipBlocksInsert(
  row: { startedAt?: string | null; endedAt?: string | null },
  today = new Date().toISOString().slice(0, 10)
): boolean {
  return membershipIsOpen(row) || membershipIsCurrent(row, today);
}

export type ExistingReview = {
  sourceLine: number;
  rawName: string;
  status: ImportReviewStatus;
  houseNumber?: number;
  role?: HouseChurchRole;
  kind?: string | null;
  matchType?: string | null;
  candidateContactIds?: string[];
};

export type ImportSnapshot = {
  houses: HouseRef[];
  contacts: ContactName[];
  members: ExistingMember[];
  reviews: ExistingReview[];
  orgPeopleContactIds: string[];
};

export type PlannedLink = {
  sourceLine: number;
  rawName: string;
  houseId: string;
  houseNumber: number;
  contactId: string;
  role: HouseChurchRole;
  outcome: "insert" | "already_linked" | "role_conflict";
  existingRole?: HouseChurchRole;
};

export type PlannedReview = {
  sourceLine: number;
  rawName: string;
  houseNumber: number;
  role: HouseChurchRole;
  kind: string | null;
  matchType: ImportMatchType;
  candidateContactIds: string[];
  note: string | null;
  outcome: "insert" | "update_pending" | "unchanged" | "leave_resolved";
};

export type RoleConflictReport = {
  sourceLine: number;
  houseNumber: number;
  sheetRole: HouseChurchRole;
  existingRole: HouseChurchRole;
};

export type ImportSummary = {
  autoLinked: number;
  alreadyLinked: number;
  roleConflicts: number;
  orgPeopleToCreate: number;
  toReviewByReason: Record<ImportMatchType, number>;
  resolvedLeftUntouched: number;
};

export type ImportPlan = {
  links: PlannedLink[];
  reviews: PlannedReview[];
  orgPeopleToCreate: string[];
  conflicts: RoleConflictReport[];
  summary: ImportSummary;
};

export type ImportWriter = {
  insertMember(link: PlannedLink): Promise<void>;
  insertOrgPerson(contactId: string): Promise<void>;
  insertReview(review: PlannedReview): Promise<void>;
  updateReview(review: PlannedReview): Promise<void>;
};

const AUTO_KINDS = new Set(["person", "couple_split"]);

export function normalizePersonName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/['’`]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function mapSheetRole(value: string): HouseChurchRole | null {
  const role = value.trim();
  if (role === "Leader 1") return "leader";
  if (role === "Leader 2") return "co_leader";
  if (role === "Member") return "member";
  return null;
}

export function supabaseProjectRef(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const [ref, ...rest] = host.split(".");
    if (!ref || rest.length < 2) return null;
    if (!/^[a-z0-9]+$/i.test(ref)) return null;
    return ref;
  } catch {
    return null;
  }
}

export function parseImportCli(argv: string[]):
  | { ok: true; csvPath: string; apply: boolean; projectRef: string | null; approveProd: boolean }
  | { ok: false; error: string } {
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
      if (!value || value.startsWith("--")) {
        return { ok: false, error: "--project-ref needs a value." };
      }
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

/**
 * Writing needs --apply and --project-ref equal to the ref in the Supabase URL.
 * The production ref also needs --i-have-approval-for-prod. Dry-run skips this.
 */
export function checkImportWriteGate(input: {
  apply: boolean;
  projectRef: string | null;
  supabaseUrl: string | undefined;
  approveProd: boolean;
}): { ok: true } | { ok: false; error: string } {
  if (!input.apply) return { ok: true };
  if (!input.projectRef) {
    return {
      ok: false,
      error: "Writing requires --apply and --project-ref=<ref> matching NEXT_PUBLIC_SUPABASE_URL.",
    };
  }
  const actual = supabaseProjectRef(input.supabaseUrl);
  if (!actual) {
    return { ok: false, error: "NEXT_PUBLIC_SUPABASE_URL is missing or has no project ref. Nothing was written." };
  }
  if (actual !== input.projectRef) {
    return {
      ok: false,
      error: `Refusing to write. --project-ref=${input.projectRef} does not match the Supabase URL ref ${actual}.`,
    };
  }
  if (actual === MISSIO_PROD_PROJECT_REF && !input.approveProd) {
    return {
      ok: false,
      error:
        "Refusing to write to production. Re-run with --i-have-approval-for-prod only after you have approval. Nothing was written.",
    };
  }
  return { ok: true };
}

export function parseHouseChurchCsv(text: string): { ok: true; rows: CsvHouseRow[] } | { ok: false; error: string } {
  let table: string[][];
  try {
    table = parseCsvTable(text);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The CSV could not be parsed." };
  }
  if (table.length === 0) return { ok: false, error: "The CSV is empty." };

  const header = table[0].map((cell) => cell.trim());
  const missing = HOUSE_CHURCH_CSV_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    return { ok: false, error: `The CSV is missing column ${missing[0]}.` };
  }
  const index = new Map(header.map((column, position) => [column, position]));
  const rows: CsvHouseRow[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    if (cells.length === 1 && cells[0].trim() === "") continue;
    const lineNo = i + 1;
    if (cells.length < header.length) {
      return { ok: false, error: `Row ${lineNo} does not have every column.` };
    }
    const cell = (column: string) => (cells[index.get(column) ?? -1] ?? "").trim();
    const sourceLine = parseWholeNumber(cell("source_line"));
    const houseNumber = parseWholeNumber(cell("house"));
    if (sourceLine === null || sourceLine < 1) {
      return { ok: false, error: `Row ${lineNo} has a bad source_line.` };
    }
    if (houseNumber === null || houseNumber < 1) {
      return { ok: false, error: `Row ${lineNo} has a bad house number.` };
    }
    const role = mapSheetRole(cell("role"));
    if (!role) {
      return { ok: false, error: `Row ${lineNo} has an unknown role. Expected Leader 1, Leader 2, or Member.` };
    }
    const rawName = cell("raw_name");
    if (!rawName) return { ok: false, error: `Row ${lineNo} is missing raw_name.` };
    const key = `${sourceLine}\0${rawName}`;
    if (seen.has(key)) {
      return { ok: false, error: `Row ${lineNo} repeats source_line and raw_name.` };
    }
    seen.add(key);
    rows.push({
      sourceLine,
      houseNumber,
      role,
      rawName,
      first: cell("first"),
      last: cell("last"),
      peopleCountOnRow: parseWholeNumber(cell("people_count_on_row")) ?? 0,
      kind: cell("kind").toLowerCase(),
      note: cell("note"),
      partIndex: parseWholeNumber(cell("part_index")) ?? 0,
      partsInRow: parseWholeNumber(cell("parts_in_row")) ?? 0,
    });
  }

  return { ok: true, rows };
}

export function classifyHouseChurchRow(
  row: Pick<CsvHouseRow, "kind" | "first" | "last">,
  contacts: ContactName[]
): { action: "link"; contactId: string } | { action: "review"; matchType: ImportMatchType; candidateContactIds: string[] } {
  const kind = row.kind.trim().toLowerCase();
  const first = row.first.trim();
  const last = row.last.trim();
  const bothNames = Boolean(first && last);
  const exact = bothNames ? exactContactIds(contacts, first, last) : [];

  if (kind === "family_label") {
    return {
      action: "review",
      matchType: "family_label",
      candidateContactIds: (bothNames ? exact : candidatesByGivenName(contacts, first)).slice(0, 5),
    };
  }
  if (kind === "first_only") {
    return {
      action: "review",
      matchType: "first_only",
      candidateContactIds: (bothNames ? exact : candidatesByGivenName(contacts, first)).slice(0, 5),
    };
  }
  if (!bothNames || !AUTO_KINDS.has(kind)) {
    const candidates = bothNames
      ? exact
      : first
        ? candidatesByGivenName(contacts, first)
        : candidatesByLastName(contacts, last);
    return { action: "review", matchType: "partial", candidateContactIds: candidates.slice(0, 5) };
  }
  if (exact.length === 1) return { action: "link", contactId: exact[0] };
  if (exact.length === 0) return { action: "review", matchType: "none", candidateContactIds: [] };
  return { action: "review", matchType: "multiple", candidateContactIds: exact.slice(0, 5) };
}

export function planHouseChurchImport(
  rows: CsvHouseRow[],
  snapshot: ImportSnapshot
): { ok: true; plan: ImportPlan } | { ok: false; missingHouses: number[] } {
  const houses = new Map(snapshot.houses.map((house) => [house.number, house]));
  const missing = [...new Set(rows.map((row) => row.houseNumber).filter((number) => !houses.has(number)))].sort(
    (a, b) => a - b
  );
  if (missing.length > 0) return { ok: false, missingHouses: missing };

  const active = new Map<string, ExistingMember>();
  for (const member of snapshot.members) {
    if (!membershipBlocksInsert(member)) continue;
    const key = `${member.houseChurchId}\0${member.contactId}`;
    const previous = active.get(key);
    if (!previous || (membershipIsOpen(member) && !membershipIsOpen(previous))) {
      active.set(key, member);
    }
  }
  const reviews = new Map(snapshot.reviews.map((review) => [`${review.sourceLine}\0${review.rawName}`, review]));
  const inOrg = new Set(snapshot.orgPeopleContactIds);

  const links: PlannedLink[] = [];
  const plannedReviews: PlannedReview[] = [];

  for (const row of rows) {
    const house = houses.get(row.houseNumber);
    if (!house) continue;
    const classified = classifyHouseChurchRow(row, snapshot.contacts);
    if (classified.action === "link") {
      const existing = active.get(`${house.id}\0${classified.contactId}`);
      let outcome: PlannedLink["outcome"] = "insert";
      if (existing && existing.role === row.role) outcome = "already_linked";
      else if (existing) outcome = "role_conflict";
      links.push({
        sourceLine: row.sourceLine,
        rawName: row.rawName,
        houseId: house.id,
        houseNumber: row.houseNumber,
        contactId: classified.contactId,
        role: row.role,
        outcome,
        existingRole: existing?.role,
      });
      continue;
    }

    const planned: PlannedReview = {
      sourceLine: row.sourceLine,
      rawName: row.rawName,
      houseNumber: row.houseNumber,
      role: row.role,
      kind: row.kind || null,
      matchType: classified.matchType,
      candidateContactIds: classified.candidateContactIds,
      note: row.note || null,
      outcome: "insert",
    };
    const existing = reviews.get(`${row.sourceLine}\0${row.rawName}`);
    if (!existing) planned.outcome = "insert";
    else if (existing.status !== "pending") planned.outcome = "leave_resolved";
    else if (reviewUnchanged(existing, planned)) planned.outcome = "unchanged";
    else planned.outcome = "update_pending";
    plannedReviews.push(planned);
  }

  const orgPeopleToCreate: string[] = [];
  const seenContacts = new Set<string>();
  for (const link of links) {
    if (seenContacts.has(link.contactId) || inOrg.has(link.contactId)) {
      seenContacts.add(link.contactId);
      continue;
    }
    seenContacts.add(link.contactId);
    orgPeopleToCreate.push(link.contactId);
  }

  const toReviewByReason = emptyReasons();
  let resolvedLeftUntouched = 0;
  for (const review of plannedReviews) {
    if (review.outcome === "leave_resolved") {
      resolvedLeftUntouched += 1;
      continue;
    }
    toReviewByReason[review.matchType] += 1;
  }

  const summary: ImportSummary = {
    autoLinked: links.filter((link) => link.outcome === "insert").length,
    alreadyLinked: links.filter((link) => link.outcome === "already_linked").length,
    roleConflicts: links.filter((link) => link.outcome === "role_conflict").length,
    orgPeopleToCreate: orgPeopleToCreate.length,
    toReviewByReason,
    resolvedLeftUntouched,
  };

  return {
    ok: true,
    plan: {
      links,
      reviews: plannedReviews,
      orgPeopleToCreate,
      conflicts: links
        .filter((link) => link.outcome === "role_conflict" && link.existingRole)
        .map((link) => ({
          sourceLine: link.sourceLine,
          houseNumber: link.houseNumber,
          sheetRole: link.role,
          existingRole: link.existingRole as HouseChurchRole,
        })),
      summary,
    },
  };
}

export async function applyHouseChurchImport(
  plan: ImportPlan,
  writer: ImportWriter,
  options: { apply: boolean }
): Promise<{ wrote: number }> {
  if (!options.apply) return { wrote: 0 };
  let wrote = 0;
  for (const link of plan.links) {
    if (link.outcome !== "insert") continue;
    await writer.insertMember(link);
    wrote += 1;
  }
  for (const contactId of plan.orgPeopleToCreate) {
    await writer.insertOrgPerson(contactId);
    wrote += 1;
  }
  for (const review of plan.reviews) {
    if (review.outcome === "insert") {
      await writer.insertReview(review);
      wrote += 1;
    } else if (review.outcome === "update_pending") {
      await writer.updateReview(review);
      wrote += 1;
    }
  }
  return { wrote };
}

export function formatImportSummary(summary: ImportSummary, conflicts: RoleConflictReport[]): string {
  const lines = [
    `auto-linked: ${summary.autoLinked}`,
    `already linked: ${summary.alreadyLinked}`,
    `role conflicts left unchanged: ${summary.roleConflicts}`,
    `org_people to create: ${summary.orgPeopleToCreate}`,
    "to review by reason:",
    ...IMPORT_MATCH_TYPES.map((reason) => `  ${reason}: ${summary.toReviewByReason[reason]}`),
    `already resolved, left untouched: ${summary.resolvedLeftUntouched}`,
  ];
  for (const conflict of conflicts) {
    lines.push(
      `role conflict source_line ${conflict.sourceLine} house ${conflict.houseNumber}: sheet ${conflict.sheetRole}, active row ${conflict.existingRole}`
    );
  }
  return lines.join("\n");
}

export async function runHouseChurchImport(input: {
  rows: CsvHouseRow[];
  snapshot: ImportSnapshot;
  apply: boolean;
  writer: ImportWriter;
}): Promise<{ ok: true; plan: ImportPlan; wrote: number } | { ok: false; message: string; wrote: 0 }> {
  const planned = planHouseChurchImport(input.rows, input.snapshot);
  if (!planned.ok) {
    return {
      ok: false,
      wrote: 0,
      message: `House number ${planned.missingHouses.join(", ")} is not seeded for Missio. Nothing was written.`,
    };
  }
  const applied = await applyHouseChurchImport(planned.plan, input.writer, { apply: input.apply });
  return { ok: true, plan: planned.plan, wrote: applied.wrote };
}

function emptyReasons(): Record<ImportMatchType, number> {
  return { none: 0, multiple: 0, family_label: 0, first_only: 0, partial: 0 };
}

function reviewUnchanged(existing: ExistingReview, planned: PlannedReview): boolean {
  const candidates = existing.candidateContactIds ?? [];
  return (
    existing.houseNumber === planned.houseNumber &&
    existing.role === planned.role &&
    (existing.kind ?? null) === planned.kind &&
    (existing.matchType ?? null) === planned.matchType &&
    candidates.length === planned.candidateContactIds.length &&
    candidates.every((id, index) => id === planned.candidateContactIds[index])
  );
}

function nameKey(first: string, last: string): string {
  return `${normalizePersonName(first)}\0${normalizePersonName(last)}`;
}

function exactContactIds(contacts: ContactName[], first: string, last: string): string[] {
  const target = nameKey(first, last);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const contact of contacts) {
    const lastName = contact.lastName ?? "";
    const givens = [contact.firstName, contact.preferredName];
    const matched = givens.some((given) => Boolean(given && given.trim() && nameKey(given, lastName) === target));
    if (!matched || seen.has(contact.id)) continue;
    seen.add(contact.id);
    ids.push(contact.id);
  }
  return ids;
}

function candidatesByGivenName(contacts: ContactName[], first: string): string[] {
  const target = normalizePersonName(first);
  if (!target) return [];
  const ids: string[] = [];
  for (const contact of contacts) {
    const givens = [contact.firstName, contact.preferredName];
    if (givens.some((given) => Boolean(given && normalizePersonName(given) === target))) ids.push(contact.id);
  }
  return ids;
}

function candidatesByLastName(contacts: ContactName[], last: string): string[] {
  const target = normalizePersonName(last);
  if (!target) return [];
  return contacts.filter((contact) => contact.lastName && normalizePersonName(contact.lastName) === target).map((contact) => contact.id);
}

function parseWholeNumber(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return null;
  return number;
}

function parseCsvTable(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const character = input[i];
    if (inQuotes) {
      if (character === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"') {
      inQuotes = true;
      continue;
    }
    if (character === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (character === "\n") {
      row.push(cell);
      cell = "";
      if (!(row.length === 1 && row[0] === "")) rows.push(row);
      row = [];
      continue;
    }
    cell += character;
  }

  if (inQuotes) throw new Error("The CSV has an unclosed quote.");
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
  }
  return rows;
}
