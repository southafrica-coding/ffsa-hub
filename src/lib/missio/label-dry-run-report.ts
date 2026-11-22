// Read-only report: contacts with the Missio label who are not Missio people.
//
// Jack's rule (22 Nov 2026): being in a Missio house church is the only
// measure of Missio membership. The `missio` contact label is a marketing /
// CRM tag (event tickets, an old CSV, forms). It is not membership, so this
// report never proposes inserting labelled contacts into org_people.
//
// Everything here is pure: the script loads rows, these helpers count,
// group and format them. Nothing in this module talks to a database.

import { maskName } from "./mask";

export const WRITES_NEED_JACK_OK = "writes need a separate Jack OK.";

export const MISSIO_LABEL_SLUG = "missio";
export const MISSIO_STUDENTS_LABEL_SLUG = "missio-students";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export type ReportContact = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  source: string | null;
  createdAt: string | null;
};

export type ReportOrgPerson = { contactId: string; status: string | null; campus: string | null };

export type ReportHouse = {
  id: string;
  number: number;
  name: string | null;
  meetingDay: string | null;
  location: string | null;
  leaderNotes: string | null;
};

export type ReportMember = { houseChurchId: string; contactId: string; endedAt: string | null };

export type ReportImportReview = {
  status: string;
  resolvedContactId: string | null;
  resolvedAt: string | null;
};

export type LabelReportSnapshot = {
  /** Contacts holding the `missio` label. */
  labelled: ReportContact[];
  /** Contacts holding the `missio-students` label. Listed separately, never folded in. */
  studentsLabelled: ReportContact[];
  orgPeople: ReportOrgPerson[];
  houses: ReportHouse[];
  members: ReportMember[];
  reviews: ReportImportReview[];
};

export type GroupCount = { key: string; count: number };

export type LabelReport = {
  counts: {
    labelled: number;
    orgPeople: number;
    houses: number;
    openMemberships: number;
    uniqueHouseMembers: number;
    labelledNotInOrgPeople: number;
    labelledNotInOrgPeopleNotInHouse: number;
    orgPeopleNotInHouse: number;
    houseMembersNotInOrgPeople: number;
    peopleInTwoOrMoreHouses: number;
    orgPeopleWithoutLabel: number;
  };
  /** Labelled, not in org_people and not in a house: the review list. */
  leftovers: ReportContact[];
  bySource: GroupCount[];
  byPhone: { withPhone: number; withoutPhone: number };
  byEmail: { withEmail: number; withoutEmail: number };
  byStatus: GroupCount[];
  createdRange: { first: string | null; last: string | null };
  students: { labelled: number; inOrgPeople: number; inHouse: number; alsoMissioLabel: number };
  reviews: {
    total: number;
    byStatus: GroupCount[];
    unresolved: number;
    withContact: number;
    withoutContact: number;
  };
  emptyHouseFields: { name: number; meetingDay: number; location: number; leaderNotes: number };
};

// ────────────────────────────────────────────────────────────
// CLI
// ────────────────────────────────────────────────────────────

export function parseReportCli(
  argv: string[],
  env: { CI?: string } = {}
): { ok: true; includePii: boolean } | { ok: false; error: string } {
  let includePii = false;
  for (const arg of argv) {
    if (arg === "--include-pii") {
      includePii = true;
      continue;
    }
    // Stub only. This PR has no write path.
    if (arg === "--apply" || arg.startsWith("--apply=")) {
      return { ok: false, error: `--apply is not available: ${WRITES_NEED_JACK_OK}` };
    }
    return { ok: false, error: `Unknown argument ${arg}. Only --include-pii is accepted.` };
  }
  if (includePii && env.CI) {
    return { ok: false, error: "--include-pii is refused when CI is set. Run it on a trusted machine only." };
  }
  return { ok: true, includePii };
}

// ────────────────────────────────────────────────────────────
// Building the report
// ────────────────────────────────────────────────────────────

function isOpen(member: ReportMember): boolean {
  return member.endedAt === null || member.endedAt === undefined || member.endedAt === "";
}

function blank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === "";
}

function groupCounts(values: string[]): GroupCount[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function uniqueById(contacts: ReportContact[]): ReportContact[] {
  const seen = new Map<string, ReportContact>();
  for (const contact of contacts) if (!seen.has(contact.id)) seen.set(contact.id, contact);
  return [...seen.values()];
}

export function buildLabelReport(snapshot: LabelReportSnapshot): LabelReport {
  const labelled = uniqueById(snapshot.labelled);
  const students = uniqueById(snapshot.studentsLabelled);
  const labelledIds = new Set(labelled.map((contact) => contact.id));
  const orgIds = new Set(snapshot.orgPeople.map((person) => person.contactId));

  const houseIds = new Set(snapshot.houses.map((house) => house.id));
  const openMembers = snapshot.members.filter((member) => isOpen(member) && houseIds.has(member.houseChurchId));
  const housesPerContact = new Map<string, Set<string>>();
  for (const member of openMembers) {
    const set = housesPerContact.get(member.contactId) ?? new Set<string>();
    set.add(member.houseChurchId);
    housesPerContact.set(member.contactId, set);
  }
  const inHouse = (id: string) => housesPerContact.has(id);

  const notInOrg = labelled.filter((contact) => !orgIds.has(contact.id));
  const leftovers = notInOrg
    .filter((contact) => !inHouse(contact.id))
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id));

  const created = leftovers.map((contact) => contact.createdAt).filter((value): value is string => !blank(value));
  created.sort((a, b) => Date.parse(a) - Date.parse(b));

  const reviewStatuses = snapshot.reviews.map((review) => review.status);
  const withContact = snapshot.reviews.filter((review) => !blank(review.resolvedContactId)).length;

  return {
    counts: {
      labelled: labelled.length,
      orgPeople: orgIds.size,
      houses: snapshot.houses.length,
      openMemberships: openMembers.length,
      uniqueHouseMembers: housesPerContact.size,
      labelledNotInOrgPeople: notInOrg.length,
      labelledNotInOrgPeopleNotInHouse: leftovers.length,
      orgPeopleNotInHouse: [...orgIds].filter((id) => !inHouse(id)).length,
      houseMembersNotInOrgPeople: [...housesPerContact.keys()].filter((id) => !orgIds.has(id)).length,
      peopleInTwoOrMoreHouses: [...housesPerContact.values()].filter((set) => set.size >= 2).length,
      orgPeopleWithoutLabel: [...orgIds].filter((id) => !labelledIds.has(id)).length,
    },
    leftovers,
    bySource: groupCounts(leftovers.map((contact) => (blank(contact.source) ? "(no source)" : contact.source!.trim()))),
    byPhone: {
      withPhone: leftovers.filter((contact) => !blank(contact.phone)).length,
      withoutPhone: leftovers.filter((contact) => blank(contact.phone)).length,
    },
    byEmail: {
      withEmail: leftovers.filter((contact) => !blank(contact.email)).length,
      withoutEmail: leftovers.filter((contact) => blank(contact.email)).length,
    },
    byStatus: groupCounts(leftovers.map((contact) => (blank(contact.status) ? "(no status)" : contact.status!))),
    createdRange: { first: created[0] ?? null, last: created[created.length - 1] ?? null },
    students: {
      labelled: students.length,
      inOrgPeople: students.filter((contact) => orgIds.has(contact.id)).length,
      inHouse: students.filter((contact) => inHouse(contact.id)).length,
      alsoMissioLabel: students.filter((contact) => labelledIds.has(contact.id)).length,
    },
    reviews: {
      total: snapshot.reviews.length,
      byStatus: groupCounts(reviewStatuses),
      unresolved: snapshot.reviews.filter((review) => blank(review.resolvedAt)).length,
      withContact,
      withoutContact: snapshot.reviews.length - withContact,
    },
    emptyHouseFields: {
      name: snapshot.houses.filter((house) => blank(house.name)).length,
      meetingDay: snapshot.houses.filter((house) => blank(house.meetingDay)).length,
      location: snapshot.houses.filter((house) => blank(house.location)).length,
      leaderNotes: snapshot.houses.filter((house) => blank(house.leaderNotes)).length,
    },
  };
}

// ────────────────────────────────────────────────────────────
// Formatting
// ────────────────────────────────────────────────────────────

/** Contact id prefix: enough to find the row in the Hub, not enough to name anyone. */
export function contactIdPrefix(id: string): string {
  return id.slice(0, 8);
}

/** SAST wall-clock time, e.g. "2026-05-25 18:46 SAST". */
export function formatSast(iso: string | null): string {
  if (!iso) return "-";
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "-";
  // SAST is UTC+2 all year (no daylight saving).
  const shifted = new Date(time + 2 * 60 * 60 * 1000).toISOString();
  return `${shifted.slice(0, 10)} ${shifted.slice(11, 16)} SAST`;
}

/** One line per leftover. Masked by default; full details only with includePii. */
export function describeLeftover(contact: ReportContact, includePii: boolean): string {
  const hasPhone = blank(contact.phone) ? "no phone" : "phone";
  const hasEmail = blank(contact.email) ? "no email" : "email";
  const source = blank(contact.source) ? "(no source)" : contact.source!.trim();
  const head = `${contactIdPrefix(contact.id)}  ${formatSast(contact.createdAt)}  ${source}`;
  if (!includePii) {
    return `${head}  ${maskName(contact.firstName, contact.lastName)}  ${hasPhone}, ${hasEmail}`;
  }
  const name = [contact.firstName, contact.lastName].filter((part) => !blank(part)).join(" ") || "(no name)";
  return `${head}  ${name}  ${contact.email ?? "(no email)"}  ${contact.phone ?? "(no phone)"}`;
}

export function formatLabelReport(report: LabelReport, options: { includePii: boolean }): string {
  const c = report.counts;
  const lines: string[] = [];
  const check = (value: number) => (value === 0 ? "ok" : "CHECK");

  lines.push("Missio label dry-run report (read-only, nothing was written)");
  lines.push("Rule: being in a Missio house church is the only measure of Missio membership.");
  lines.push("");
  lines.push("1. Counts");
  lines.push(`  contacts with the missio label:                 ${c.labelled}`);
  lines.push(`  Missio org_people:                              ${c.orgPeople}`);
  lines.push(`  Missio houses:                                  ${c.houses}`);
  lines.push(`  open house memberships:                         ${c.openMemberships}`);
  lines.push(`  unique open house members:                      ${c.uniqueHouseMembers}`);
  lines.push(`  people in two or more houses:                   ${c.peopleInTwoOrMoreHouses}`);
  lines.push(`  labelled, not in org_people:                    ${c.labelledNotInOrgPeople}`);
  lines.push(`  labelled, not in org_people, not in a house:    ${c.labelledNotInOrgPeopleNotInHouse}`);
  lines.push(`  org_people not in a house (expect 0):           ${c.orgPeopleNotInHouse} ${check(c.orgPeopleNotInHouse)}`);
  lines.push(
    `  house members not in org_people (expect 0):     ${c.houseMembersNotInOrgPeople} ${check(c.houseMembersNotInOrgPeople)}`
  );
  lines.push(`  org_people without the label (expect 0):        ${c.orgPeopleWithoutLabel} ${check(c.orgPeopleWithoutLabel)}`);
  lines.push("");

  lines.push(`2. Labelled contacts who are not Missio people (${report.leftovers.length})`);
  lines.push("  by source:");
  for (const group of report.bySource) lines.push(`    ${group.key}: ${group.count}`);
  lines.push(`  with a phone: ${report.byPhone.withPhone}, without: ${report.byPhone.withoutPhone}`);
  lines.push(`  with an email: ${report.byEmail.withEmail}, without: ${report.byEmail.withoutEmail}`);
  lines.push(`  contact status: ${report.byStatus.map((group) => `${group.key} ${group.count}`).join(", ") || "-"}`);
  lines.push(`  created: ${formatSast(report.createdRange.first)} to ${formatSast(report.createdRange.last)}`);
  lines.push(
    options.includePii
      ? "  list (PII INCLUDED - trusted machine only, do not paste into CI, chat or a PR):"
      : "  list (masked: id prefix, initials; pass --include-pii on a trusted machine for full details):"
  );
  for (const contact of report.leftovers) lines.push(`    ${describeLeftover(contact, options.includePii)}`);
  lines.push("");

  const s = report.students;
  lines.push("   missio-students label (listed separately, not part of the list above)");
  lines.push(
    `    contacts: ${s.labelled}, also have the missio label: ${s.alsoMissioLabel}, in org_people: ${s.inOrgPeople}, in a house: ${s.inHouse}`
  );
  lines.push("");

  lines.push("3. Recommendation");
  lines.push("  Do NOT insert these contacts into org_people. Membership is house church only,");
  lines.push("  and none of them is in a house. They carry the missio marketing / CRM label from");
  lines.push("  event tickets, an old CSV and forms, which is an interest, not membership.");
  lines.push("  Options:");
  lines.push("    a. Leave the label as an interest tag (no change).");
  lines.push("    b. Give pastors this list to review; anyone who belongs gets added to a house");
  lines.push("       through the Hub, and org_people follows from that.");
  lines.push("    c. Remove the missio label from people who were never in a house. That is a");
  lines.push(`       write: a future, separately approved change (${WRITES_NEED_JACK_OK})`);
  lines.push("");

  const r = report.reviews;
  lines.push("4. House-church sheet import (missio_import_review)");
  lines.push(`  rows: ${r.total} (${r.byStatus.map((group) => `${group.key} ${group.count}`).join(", ") || "-"})`);
  lines.push(`  with a contact: ${r.withContact}, without: ${r.withoutContact}`);
  lines.push(
    r.unresolved === 0
      ? "  all rows are resolved: the sheet import has already run. This is a log, not an open queue."
      : `  unresolved rows: ${r.unresolved} CHECK`
  );
  lines.push("");

  const e = report.emptyHouseFields;
  lines.push("5. Data quality: house details");
  lines.push(`  of ${c.houses} houses, empty name: ${e.name}, meeting day: ${e.meetingDay}, location: ${e.location}, leader notes: ${e.leaderNotes}`);
  if (c.houses > 0 && e.name === c.houses && e.location === c.houses) {
    lines.push("  Houses are numbers only. Pastors should fill these in the Hub; this script does not invent them.");
  }
  return lines.join("\n");
}
