// Read-only report (writes nothing, there is no apply mode):
//   npx tsx scripts/missio-label-dry-run-report.ts
//
// Contacts with the missio label who are not Missio people. Jack's rule
// (22 Nov 2026): being in a Missio house church is the only measure of Missio
// membership. The label is a marketing / CRM tag, so this script never
// inserts labelled contacts into org_people. Closed draft #621 (backfill
// org_people from the label) is the wrong approach now; do not revive it.
//
// Output is masked by default: contact id prefix, initials, and whether a
// phone / email exists. No phone numbers, emails or full names. Safe for CI
// logs.
//
// Full names, emails and phones, for a pastor on a trusted machine only:
//   npx tsx scripts/missio-label-dry-run-report.ts --include-pii
// Never paste that output into CI, chat, a PR or an issue. Refused when CI is set.
//
// --apply is a stub that exits: writes need a separate Jack OK.
//
// Uses NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (already in
// .env.local), like scripts/missio-import-house-churches.ts. Neither value is
// ever printed. The service role is needed to read past RLS; the script
// only reaches the database through readOnly() below, which exposes select
// and nothing else.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  MISSIO_LABEL_SLUG,
  MISSIO_STUDENTS_LABEL_SLUG,
  buildLabelReport,
  formatLabelReport,
  parseReportCli,
  type ReportContact,
  type ReportHouse,
  type ReportImportReview,
  type ReportMember,
  type ReportOrgPerson,
} from "../src/lib/missio/label-dry-run-report";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;

/** Only select is reachable. A filter builder from select cannot turn into a write. */
type ReadOnlyDb = { select: (table: string, columns: string) => Query };

function readOnly(db: Db): ReadOnlyDb {
  return { select: (table, columns) => db.from(table).select(columns) };
}

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

async function fetchAll(
  db: ReadOnlyDb,
  table: string,
  columns: string,
  orderBy: string,
  apply?: (query: Query) => Query
) {
  const pageSize = 1000;
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += pageSize) {
    let query = db.select(table, columns).order(orderBy, { ascending: true }).range(from, from + pageSize - 1);
    if (apply) query = apply(query);
    const { data, error } = await query;
    if (error) {
      console.error(`[missio-label-report] ${table} read failed`, error.message ?? error.code ?? "query error");
      throw new Error(`Could not read ${table}.`);
    }
    const batch = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

function str(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

async function labelledContacts(db: ReadOnlyDb, labelId: string | null): Promise<ReportContact[]> {
  if (!labelId) return [];
  const ids = (
    await fetchAll(db, "contact_labels", "contact_id", "contact_id", (query) => query.eq("label_id", labelId))
  ).map((row) => String(row.contact_id));
  const contacts: ReportContact[] = [];
  for (let index = 0; index < ids.length; index += 200) {
    const slice = ids.slice(index, index + 200);
    const rows = await fetchAll(
      db,
      "contacts",
      "id, first_name, last_name, email, phone, status, source, created_at",
      "id",
      (query) => query.in("id", slice)
    );
    for (const row of rows) {
      contacts.push({
        id: String(row.id),
        firstName: str(row.first_name),
        lastName: str(row.last_name),
        email: str(row.email),
        phone: str(row.phone),
        status: str(row.status),
        source: str(row.source),
        createdAt: str(row.created_at),
      });
    }
  }
  return contacts;
}

async function main() {
  const args = parseReportCli(process.argv.slice(2), { CI: process.env.CI });
  if (!args.ok) {
    console.error(args.error);
    process.exit(1);
  }

  loadLocalEnv();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const db = readOnly(
    createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  );

  const org = await db.select("organisations", "id").eq("slug", "missio").maybeSingle();
  if (org.error || !org.data?.id) {
    console.error("[missio-label-report] organisation lookup failed", org.error?.message ?? "missio");
    process.exit(1);
  }
  const orgId = String(org.data.id);

  const labels = await fetchAll(db, "labels", "id, slug", "id", (query) =>
    query.in("slug", [MISSIO_LABEL_SLUG, MISSIO_STUDENTS_LABEL_SLUG])
  );
  const labelId = (slug: string) => str(labels.find((row) => row.slug === slug)?.id);
  if (!labelId(MISSIO_LABEL_SLUG)) {
    console.error(`[missio-label-report] label "${MISSIO_LABEL_SLUG}" not found`);
    process.exit(1);
  }

  const labelled = await labelledContacts(db, labelId(MISSIO_LABEL_SLUG));
  const studentsLabelled = await labelledContacts(db, labelId(MISSIO_STUDENTS_LABEL_SLUG));

  const orgPeople = (
    await fetchAll(db, "org_people", "id, contact_id, status, campus", "id", (query) => query.eq("org_id", orgId))
  ).map((row): ReportOrgPerson => ({ contactId: String(row.contact_id), status: str(row.status), campus: str(row.campus) }));

  const houses = (
    await fetchAll(db, "house_churches", "id, number, name, meeting_day, location, leader_notes", "id", (query) =>
      query.eq("org_id", orgId)
    )
  ).map(
    (row): ReportHouse => ({
      id: String(row.id),
      number: Number(row.number),
      name: str(row.name),
      meetingDay: str(row.meeting_day),
      location: str(row.location),
      leaderNotes: str(row.leader_notes),
    })
  );

  const houseIds = houses.map((house) => house.id);
  const members: ReportMember[] = houseIds.length
    ? (
        await fetchAll(db, "house_church_members", "id, house_church_id, contact_id, ended_at", "id", (query) =>
          query.in("house_church_id", houseIds)
        )
      ).map((row) => ({
        houseChurchId: String(row.house_church_id),
        contactId: String(row.contact_id),
        endedAt: str(row.ended_at),
      }))
    : [];

  const reviews = (
    await fetchAll(db, "missio_import_review", "id, status, resolved_contact_id, resolved_at", "id", (query) =>
      query.eq("org_id", orgId)
    )
  ).map(
    (row): ReportImportReview => ({
      status: String(row.status),
      resolvedContactId: str(row.resolved_contact_id),
      resolvedAt: str(row.resolved_at),
    })
  );

  const report = buildLabelReport({ labelled, studentsLabelled, orgPeople, houses, members, reviews });
  console.log(formatLabelReport(report, { includePii: args.includePii }));
  console.log("");
  console.log("Read-only. Nothing was written.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Report failed.");
  process.exit(1);
});
