// Dry run (default — writes nothing):
//   npx tsx scripts/missio-import-house-churches.ts ./houses.csv
//
// Write, only when --project-ref matches NEXT_PUBLIC_SUPABASE_URL:
//   npx tsx scripts/missio-import-house-churches.ts ./houses.csv --apply --project-ref=<ref>
//
// The production ref thodakhvkcodfystnkxa also needs --i-have-approval-for-prod.
// Do not point this at production without that approval.
//
// Uses NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (already in .env.local).
// Reads contacts with the service role. Auto-link prefers contacts that
// already have a Missio org_people row. The Missio contact label is not a
// match pool. A name that is not a unique org_people match is staged for
// review and is not linked. org_people inserts, if a later plan asks for
// them, happen before the membership row, and only when --apply passes the
// project-ref gate.
// guard_house_church_member rejects a member whose contact is not already
// in org_people (23503 missio_member_not_in_org), including the service role.
// An existing org_people row is not changed, and an open membership with a
// different role is left as it is.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The house-church tables are not in the generated Database type yet.
import {
  checkEmptyOrgPeoplePool,
  checkImportWriteGate,
  formatImportSummary,
  parseHouseChurchCsv,
  parseImportCli,
  runHouseChurchImport,
  type ContactName,
  type ExistingMember,
  type ExistingReview,
  type HouseChurchRole,
  type HouseRef,
  type ImportSnapshot,
  type ImportWriter,
  type PlannedLink,
  type PlannedReview,
} from "../src/lib/missio/house-church-import";
import { todayIsoDate } from "../src/lib/missio/dates";

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
      let value = match[2].trim().replace(/^["']|["']$/g, "");
      value = value.replace(/\\n$/, "");
      process.env[key] = value;
    }
  } catch {
    // The process environment is enough when .env.local is not on disk.
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll(db: Db, table: string, columns: string, apply?: (query: any) => any) {
  const pageSize = 1000;
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += pageSize) {
    let query = db.from(table).select(columns).order("id", { ascending: true }).range(from, from + pageSize - 1);
    if (apply) query = apply(query);
    const { data, error } = await query;
    if (error) {
      console.error(`[missio-import] ${table} read failed`, error.message ?? error.code ?? "query error");
      throw new Error(`Could not read ${table}.`);
    }
    const batch = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

async function loadSnapshot(db: Db, orgId: string): Promise<ImportSnapshot> {
  const houses = (await fetchAll(db, "house_churches", "id, org_id, number", (query) => query.eq("org_id", orgId))).map(
    (row): HouseRef => ({
      id: String(row.id),
      orgId: String(row.org_id),
      number: Number(row.number),
    })
  );
  const houseIds = new Set(houses.map((house) => house.id));
  const orgPeopleContactIds = (
    await fetchAll(db, "org_people", "id, contact_id", (query) => query.eq("org_id", orgId))
  ).map((row) => String(row.contact_id));
  // Match pool is Missio org_people only. The Missio label is never the pool.
  // Hub Data backfills org_people from labelled contacts before this import.
  const matchIds = [...new Set(orgPeopleContactIds)];
  const contacts: ContactName[] = [];
  for (let index = 0; index < matchIds.length; index += 200) {
    const slice = matchIds.slice(index, index + 200);
    const named = await fetchAll(db, "contacts", "id, first_name, last_name, preferred_name", (query) =>
      query.in("id", slice)
    );
    for (const row of named) {
      contacts.push({
        id: String(row.id),
        firstName: (row.first_name as string | null) ?? null,
        lastName: (row.last_name as string | null) ?? null,
        preferredName: (row.preferred_name as string | null) ?? null,
      });
    }
  }
  const members = (await fetchAll(db, "house_church_members", "id, house_church_id, contact_id, role, started_at, ended_at"))
    .filter((row) => houseIds.has(String(row.house_church_id)))
    .map(
      (row): ExistingMember => ({
        houseChurchId: String(row.house_church_id),
        contactId: String(row.contact_id),
        role: row.role as HouseChurchRole,
        startedAt: (row.started_at as string | null) ?? null,
        endedAt: (row.ended_at as string | null) ?? null,
      })
    );
  const reviews = (await fetchAll(db, "missio_import_review", "id, source_line, raw_name, status, house_number, role, kind, match_type, candidate_contact_ids", (query) => query.eq("org_id", orgId))).map(
    (row): ExistingReview => ({
      sourceLine: Number(row.source_line),
      rawName: String(row.raw_name),
      status: row.status as ExistingReview["status"],
      houseNumber: Number(row.house_number),
      role: row.role as HouseChurchRole,
      kind: (row.kind as string | null) ?? null,
      matchType: (row.match_type as string | null) ?? null,
      candidateContactIds: Array.isArray(row.candidate_contact_ids) ? (row.candidate_contact_ids as string[]) : [],
    })
  );
  return { houses, contacts, members, reviews, orgPeopleContactIds, matchContactIds: matchIds };
}

function writerFor(db: Db, orgId: string): ImportWriter {
  return {
    async insertMember(link: PlannedLink) {
      const { error } = await db.from("house_church_members").insert({
        house_church_id: link.houseId,
        contact_id: link.contactId,
        role: link.role,
        // UTC database date, never a future start. null would also be valid:
        // the column defaults to current_date.
        started_at: todayIsoDate(),
        ended_at: null,
        // Migration 331 pins created_by to auth.uid() when that is set.
        // The service role has no auth.uid(), so the supplied value is kept.
        // This import is not attributed to a user.
        created_by: null,
      });
      if (!error) return;
      if (error.code === "23505") return;
      console.error("[missio-import] member insert failed", error.message ?? error.code);
      throw new Error("Could not add a house member.");
    },
    async insertOrgPerson(contactId: string) {
      const { error } = await db.from("org_people").insert({
        org_id: orgId,
        contact_id: contactId,
        campus: "potch",
        status: "active",
        created_by: null,
      });
      if (!error || error.code === "23505") return;
      console.error("[missio-import] org person insert failed", error.message ?? error.code);
      throw new Error("Could not add an org person.");
    },
    async insertReview(review: PlannedReview) {
      const { error } = await db.from("missio_import_review").insert({
        org_id: orgId,
        source_line: review.sourceLine,
        raw_name: review.rawName,
        house_number: review.houseNumber,
        role: review.role,
        kind: review.kind,
        match_type: review.matchType,
        candidate_contact_ids: review.candidateContactIds,
        status: "pending",
        notes: review.note,
      });
      if (!error) return;
      if (error.code === "23505") return;
      console.error("[missio-import] review insert failed", error.message ?? error.code);
      throw new Error("Could not save a review row.");
    },
    async updateReview(review: PlannedReview) {
      const { error } = await db
        .from("missio_import_review")
        .update({
          house_number: review.houseNumber,
          role: review.role,
          kind: review.kind,
          match_type: review.matchType,
          candidate_contact_ids: review.candidateContactIds,
        })
        .eq("org_id", orgId)
        .eq("source_line", review.sourceLine)
        .eq("raw_name", review.rawName)
        .eq("status", "pending");
      if (error) {
        console.error("[missio-import] review update failed", error.message ?? error.code);
        throw new Error("Could not update a review row.");
      }
    },
  };
}

async function main() {
  const args = parseImportCli(process.argv.slice(2));
  if (!args.ok) {
    console.error(args.error);
    process.exit(1);
  }

  loadLocalEnv();
  const gate = checkImportWriteGate({
    apply: args.apply,
    projectRef: args.projectRef,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    approveProd: args.approveProd,
  });
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
  const parsed = parseHouseChurchCsv(csv);
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const db: Db = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const org = await db.from("organisations").select("id").eq("slug", "missio").maybeSingle();
  if (org.error || !org.data?.id) {
    console.error("[missio-import] organisation lookup failed", org.error?.message ?? "missio");
    console.error("Missio organisation was not found. Nothing was written.");
    process.exit(1);
  }

  const snapshot = await loadSnapshot(db, org.data.id as string);
  const pool = checkEmptyOrgPeoplePool({
    count: snapshot.orgPeopleContactIds.length,
    allowEmptyPool: args.allowEmptyPool,
    supabaseUrl,
  });
  if (!pool.ok) {
    console.error(pool.error);
    process.exit(1);
  }
  const result = await runHouseChurchImport({
    rows: parsed.rows,
    snapshot,
    apply: args.apply,
    writer: writerFor(db, org.data.id as string),
  });
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }

  console.log(formatImportSummary(result.plan.summary, result.plan.conflicts));
  if (!args.apply) {
    console.log("Dry run. Nothing was written.");
    return;
  }
  console.log(`Wrote ${result.wrote} change${result.wrote === 1 ? "" : "s"}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Import failed.");
  process.exit(1);
});
