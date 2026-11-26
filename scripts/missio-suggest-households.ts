// Couple suggestions from the house church sheet (migration 398).
//
// Dry run (default — writes nothing, prints counts only, no names):
//   npx tsx scripts/missio-suggest-households.ts ./couples.csv
//
// Write pending rows, only when --project-ref matches NEXT_PUBLIC_SUPABASE_URL:
//   npx tsx scripts/missio-suggest-households.ts ./couples.csv --apply --project-ref=<ref>
//
// The production ref thodakhvkcodfystnkxa also needs --i-have-approval-for-prod.
// Do not point this at production without Jack's OK, and not before 398 is applied.
//
// CSV: the house-church import's parsed-people shape. Required columns:
//   source_line, house, first, last, kind, part_index
// Other columns (raw_name, role, note, people_count_on_row, parts_in_row)
// are ignored. Only kind = couple_split rows are used; the two halves of an
// "X & Y" cell share a source_line and have part_index 0 and 1 (or 1 and 2).
// The CSV holds real names: keep it off the repo and out of shared folders.
//
// Matching (src/lib/missio/household-suggestion-plan.ts): exact first + last
// against Missio org_people only, or the only such person in the pair's house.
// First name only, no match or several matches are skipped. A pair already in
// one household or already suggested (any status) is skipped. Existing rows are
// never changed (insert … on conflict do nothing), so accepted and dismissed
// stay as they are. No household, contact or person is ever created.
//
// Uses NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (already in .env.local).

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkImportWriteGate, type ContactName } from "../src/lib/missio/house-church-import";
import {
  formatSuggestionSummary,
  groupCouplePairs,
  parseCoupleCsv,
  parseSuggestionCli,
  runHouseholdSuggestions,
  SUGGESTION_SOURCE,
  type SuggestionSnapshot,
  type SuggestionWriter,
} from "../src/lib/missio/household-suggestion-plan";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

function loadLocalEnv() {
  try {
    const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of text.split("\n")) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (!match) continue;
      const key = match[1].trim();
      if (process.env[key]) continue;
      process.env[key] = match[2].trim().replace(/^["']|["']$/g, "").replace(/\\n$/, "");
    }
  } catch {
    // The process environment is enough when .env.local is not on disk.
  }
}

const missingTable = (code: string | undefined) => code === "42P01" || code === "PGRST205";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll(db: Db, table: string, columns: string, apply?: (query: any) => any) {
  const pageSize = 1000;
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += pageSize) {
    let query = db.from(table).select(columns).order("id", { ascending: true }).range(from, from + pageSize - 1);
    if (apply) query = apply(query);
    const { data, error } = await query;
    if (error) {
      const failure = new Error(`Could not read ${table}.`) as Error & { code?: string };
      failure.code = error.code;
      throw failure;
    }
    const batch = (data ?? []) as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

async function loadSnapshot(db: Db, orgId: string, apply: boolean): Promise<SuggestionSnapshot> {
  const people = await fetchAll(db, "org_people", "id, contact_id", (q) => q.eq("org_id", orgId));
  const poolIds = [...new Set(people.map((row) => String(row.contact_id)))];
  const contacts: ContactName[] = [];
  for (let i = 0; i < poolIds.length; i += 200) {
    const slice = poolIds.slice(i, i + 200);
    for (const row of await fetchAll(db, "contacts", "id, first_name, last_name, preferred_name", (q) => q.in("id", slice))) {
      contacts.push({
        id: String(row.id),
        firstName: (row.first_name as string | null) ?? null,
        lastName: (row.last_name as string | null) ?? null,
        preferredName: (row.preferred_name as string | null) ?? null,
      });
    }
  }
  const houses = await fetchAll(db, "house_churches", "id, number", (q) => q.eq("org_id", orgId));
  const numberOf = new Map(houses.map((row) => [String(row.id), Number(row.number)]));
  const houseMembers = (await fetchAll(db, "house_church_members", "id, house_church_id, contact_id, ended_at", (q) => q.is("ended_at", null)))
    .filter((row) => numberOf.has(String(row.house_church_id)))
    .map((row) => ({ contactId: String(row.contact_id), houseNumber: numberOf.get(String(row.house_church_id))! }));
  const households = new Set(
    (await fetchAll(db, "missio_households", "id", (q) => q.eq("org_id", orgId))).map((row) => String(row.id))
  );
  const householdAdults = (await fetchAll(db, "missio_household_members", "id, household_id, contact_id, kind", (q) => q.eq("kind", "adult")))
    .filter((row) => households.has(String(row.household_id)) && row.contact_id)
    .map((row) => ({ contactId: String(row.contact_id), householdId: String(row.household_id) }));
  let existing: SuggestionSnapshot["existing"] = [];
  try {
    existing = (await fetchAll(db, "missio_household_suggestions", "id, contact_a, contact_b", (q) => q.eq("org_id", orgId))).map((row) => ({
      contactA: String(row.contact_a),
      contactB: String(row.contact_b),
    }));
  } catch (error) {
    const code = (error as { code?: string }).code;
    // Migration 398 not applied: a dry run can still count; writing can't.
    if (!missingTable(code) || apply) throw new Error("missio_household_suggestions is not readable. Is migration 398 applied? Nothing was written.");
    console.log("Migration 398 is not applied here: counting as if no suggestions exist yet.");
  }
  return { contacts, houseMembers, householdAdults, existing };
}

function writerFor(db: Db, orgId: string): SuggestionWriter {
  return {
    async insertPending(row) {
      const { error } = await db.from("missio_household_suggestions").upsert(
        {
          org_id: orgId,
          contact_a: row.contactA,
          contact_b: row.contactB,
          source: SUGGESTION_SOURCE,
          source_line: row.sourceLine,
          status: "pending",
        },
        { onConflict: "org_id,contact_a,contact_b", ignoreDuplicates: true }
      );
      if (!error) return;
      console.error("[missio-suggest] insert failed", error.code ?? "error");
      throw new Error("Could not file a suggestion.");
    },
  };
}

async function main() {
  const args = parseSuggestionCli(process.argv.slice(2));
  if (!args.ok) {
    console.error(args.error);
    process.exit(1);
  }
  loadLocalEnv();
  const gateInput = {
    apply: args.apply,
    projectRef: args.projectRef,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    approveProd: args.approveProd,
  };
  const gate = checkImportWriteGate(gateInput);
  if (!gate.ok) {
    console.error(gate.error);
    process.exit(1);
  }

  let csv: string;
  try {
    csv = readFileSync(resolve(process.cwd(), args.csvPath), "utf8");
  } catch {
    console.error("Could not read the CSV file.");
    process.exit(1);
  }
  const parsed = parseCoupleCsv(csv);
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exit(1);
  }
  const { pairs, badPairs } = groupCouplePairs(parsed.rows);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  const db: Db = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const org = await db.from("organisations").select("id").eq("slug", "missio").maybeSingle();
  if (org.error || !org.data?.id) {
    console.error("Missio organisation was not found. Nothing was written.");
    process.exit(1);
  }
  const orgId = org.data.id as string;
  const snapshot = await loadSnapshot(db, orgId, args.apply);
  const result = await runHouseholdSuggestions({ pairs, badPairs, snapshot, gate: gateInput, writer: writerFor(db, orgId) });
  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }
  console.log(formatSuggestionSummary(result.plan.summary));
  if (!args.apply) {
    console.log("Dry run. Nothing was written.");
    return;
  }
  console.log(`Filed ${result.wrote} pending suggestion${result.wrote === 1 ? "" : "s"} (existing rows left as they were).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Failed.");
  process.exit(1);
});
