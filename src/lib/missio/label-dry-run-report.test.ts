import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  WRITES_NEED_JACK_OK,
  buildLabelReport,
  contactIdPrefix,
  describeLeftover,
  formatLabelReport,
  formatSast,
  parseReportCli,
  type LabelReportSnapshot,
  type ReportContact,
  type ReportHouse,
  type ReportMember,
} from "@/lib/missio/label-dry-run-report";

// Made-up fixture with the 22 Nov 2026 prod shape. No real names, emails or phones.

function uuid(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(4, "0")}-0000-4000-8000-000000000000`;
}

function contact(n: number, overrides: Partial<ReportContact> = {}): ReportContact {
  return {
    id: uuid("c000", n),
    firstName: `Fixture${n}`,
    lastName: `Person${n}`,
    email: `fixture${n}@example.test`,
    phone: `+27 82 000 ${String(n).padStart(4, "0")}`,
    status: "active",
    source: "manual",
    createdAt: "2026-06-01T10:00:00Z",
    ...overrides,
  };
}

const SOURCES: [string, number][] = [
  ["csv:FFSA Contacts.csv", 31],
  ["ticket:missioretreat", 16],
  ["ticket:missiochurchretreat", 2],
  ["ticket:missostudentcamp2027", 2],
  ["ticket:preachers-2026", 2],
  ["ticket:ffsacampspotch", 1],
  ["form:take-action-send-night-durban", 1],
  ["ticket:wild-ones-youth-camp", 1],
];

function prodShape(): LabelReportSnapshot {
  const houses: ReportHouse[] = Array.from({ length: 20 }, (_, i) => ({
    id: uuid("h000", i + 1),
    number: i + 1,
    name: null,
    meetingDay: null,
    location: null,
    leaderNotes: null,
  }));

  // 201 house members, all in org_people, all labelled.
  const members201 = Array.from({ length: 201 }, (_, i) => contact(i + 1));
  const members: ReportMember[] = members201.map((person, i) => ({
    houseChurchId: houses[i % 20]!.id,
    contactId: person.id,
    endedAt: null,
  }));
  // Two people are open in a second house: 203 rows, 201 people.
  members.push({ houseChurchId: houses[5]!.id, contactId: members201[0]!.id, endedAt: null });
  members.push({ houseChurchId: houses[6]!.id, contactId: members201[1]!.id, endedAt: null });
  // An ended row is not open and changes nothing.
  members.push({ houseChurchId: houses[7]!.id, contactId: members201[2]!.id, endedAt: "2026-11-01" });

  // 56 labelled leftovers: 34 with a phone, all with an email.
  const leftovers: ReportContact[] = [];
  let n = 1000;
  for (const [source, count] of SOURCES) {
    for (let k = 0; k < count; k++) {
      leftovers.push(
        contact(n, {
          source,
          phone: leftovers.length < 34 ? `+27 83 000 ${String(n).padStart(4, "0")}` : null,
          createdAt: leftovers.length === 0 ? "2026-05-25T16:46:00Z" : "2026-08-01T08:00:00Z",
        })
      );
      n++;
    }
  }
  leftovers[leftovers.length - 1]!.createdAt = "2026-11-18T08:00:00Z";

  const students = Array.from({ length: 5 }, (_, i) => contact(2000 + i, { source: "form:students" }));

  const reviews = [
    ...Array.from({ length: 69 }, () => ({ status: "matched", resolvedContactId: uuid("c000", 1), resolvedAt: "2026-11-20T10:00:00Z" })),
    ...Array.from({ length: 19 }, () => ({ status: "new", resolvedContactId: uuid("c000", 2), resolvedAt: "2026-11-20T10:00:00Z" })),
    ...Array.from({ length: 47 }, () => ({ status: "skipped", resolvedContactId: null, resolvedAt: "2026-11-20T10:00:00Z" })),
  ];

  return {
    labelled: [...members201, ...leftovers],
    studentsLabelled: students,
    orgPeople: members201.map((person) => ({ contactId: person.id, status: "active", campus: "potch" })),
    houses,
    members,
    reviews,
  };
}

describe("buildLabelReport", () => {
  it("reproduces the 257 / 201 / 56 arithmetic", () => {
    const report = buildLabelReport(prodShape());
    expect(report.counts).toEqual({
      labelled: 257,
      orgPeople: 201,
      houses: 20,
      openMemberships: 203,
      uniqueHouseMembers: 201,
      labelledNotInOrgPeople: 56,
      labelledNotInOrgPeopleNotInHouse: 56,
      orgPeopleNotInHouse: 0,
      houseMembersNotInOrgPeople: 0,
      peopleInTwoOrMoreHouses: 2,
      orgPeopleWithoutLabel: 0,
    });
    expect(report.counts.labelled - report.counts.orgPeople).toBe(report.leftovers.length);
  });

  it("groups the leftovers by source and phone", () => {
    const report = buildLabelReport(prodShape());
    expect(report.bySource).toEqual([
      { key: "csv:FFSA Contacts.csv", count: 31 },
      { key: "ticket:missioretreat", count: 16 },
      { key: "ticket:missiochurchretreat", count: 2 },
      { key: "ticket:missostudentcamp2027", count: 2 },
      { key: "ticket:preachers-2026", count: 2 },
      { key: "form:take-action-send-night-durban", count: 1 },
      { key: "ticket:ffsacampspotch", count: 1 },
      { key: "ticket:wild-ones-youth-camp", count: 1 },
    ]);
    expect(report.byPhone).toEqual({ withPhone: 34, withoutPhone: 22 });
    expect(report.byEmail).toEqual({ withEmail: 56, withoutEmail: 0 });
    expect(report.byStatus).toEqual([{ key: "active", count: 56 }]);
    expect(formatSast(report.createdRange.first)).toBe("2026-05-25 18:46 SAST");
    expect(formatSast(report.createdRange.last)).toBe("2026-11-18 10:00 SAST");
  });

  it("counts a person in two houses once", () => {
    const report = buildLabelReport({
      labelled: [contact(1)],
      studentsLabelled: [],
      orgPeople: [{ contactId: contact(1).id, status: "active", campus: "potch" }],
      houses: [
        { id: "h1", number: 1, name: null, meetingDay: null, location: null, leaderNotes: null },
        { id: "h2", number: 2, name: null, meetingDay: null, location: null, leaderNotes: null },
      ],
      members: [
        { houseChurchId: "h1", contactId: contact(1).id, endedAt: null },
        { houseChurchId: "h2", contactId: contact(1).id, endedAt: null },
      ],
      reviews: [],
    });
    expect(report.counts.openMemberships).toBe(2);
    expect(report.counts.uniqueHouseMembers).toBe(1);
    expect(report.counts.peopleInTwoOrMoreHouses).toBe(1);
  });

  it("flags org_people outside a house and house members outside org_people", () => {
    const inOrgOnly = contact(1);
    const inHouseOnly = contact(2);
    const report = buildLabelReport({
      labelled: [inOrgOnly, inHouseOnly],
      studentsLabelled: [],
      orgPeople: [{ contactId: inOrgOnly.id, status: "active", campus: "potch" }],
      houses: [{ id: "h1", number: 1, name: null, meetingDay: null, location: null, leaderNotes: null }],
      members: [{ houseChurchId: "h1", contactId: inHouseOnly.id, endedAt: null }],
      reviews: [],
    });
    expect(report.counts.orgPeopleNotInHouse).toBe(1);
    expect(report.counts.houseMembersNotInOrgPeople).toBe(1);
    // In a house but not in org_people: not a leftover, it is a separate CHECK.
    expect(report.counts.labelledNotInOrgPeople).toBe(1);
    expect(report.leftovers).toHaveLength(0);
  });

  it("keeps missio-students separate from the 56", () => {
    const report = buildLabelReport(prodShape());
    expect(report.students).toEqual({ labelled: 5, inOrgPeople: 0, inHouse: 0, alsoMissioLabel: 0 });
    expect(report.leftovers.some((c) => c.source === "form:students")).toBe(false);
  });

  it("summarises the import review log and empty house fields", () => {
    const report = buildLabelReport(prodShape());
    expect(report.reviews).toEqual({
      total: 135,
      byStatus: [
        { key: "matched", count: 69 },
        { key: "skipped", count: 47 },
        { key: "new", count: 19 },
      ],
      unresolved: 0,
      withContact: 88,
      withoutContact: 47,
    });
    expect(report.emptyHouseFields).toEqual({ name: 20, meetingDay: 20, location: 20, leaderNotes: 20 });
  });
});

describe("PII", () => {
  const snapshot = prodShape();
  const report = buildLabelReport(snapshot);
  const piiValues = report.leftovers.flatMap((c) => [c.email!, c.phone, `${c.firstName} ${c.lastName}`, c.lastName!]);

  it("is off by default on the CLI", () => {
    expect(parseReportCli([])).toEqual({ ok: true, includePii: false });
    expect(parseReportCli(["--include-pii"])).toEqual({ ok: true, includePii: true });
  });

  it("masked output has no email, phone or full name", () => {
    const text = formatLabelReport(report, { includePii: false });
    for (const value of piiValues) if (value) expect(text).not.toContain(value);
    expect(text).not.toMatch(/@/);
    expect(text).toContain(contactIdPrefix(report.leftovers[0]!.id));
    expect(text).toContain("F*** P***");
  });

  it("only --include-pii prints full details", () => {
    const first = report.leftovers[0]!;
    expect(describeLeftover(first, false)).not.toContain(first.email!);
    expect(describeLeftover(first, true)).toContain(first.email!);
    expect(describeLeftover(first, true)).toContain(first.phone!);
    expect(formatLabelReport(report, { includePii: true })).toContain("trusted machine only");
  });

  it("refuses --include-pii when CI is set", () => {
    expect(parseReportCli(["--include-pii"], { CI: "true" }).ok).toBe(false);
    expect(parseReportCli([], { CI: "true" })).toEqual({ ok: true, includePii: false });
  });
});

describe("no write path", () => {
  it("--apply is a stub that refuses", () => {
    const result = parseReportCli(["--apply"]);
    expect(result).toEqual({ ok: false, error: `--apply is not available: ${WRITES_NEED_JACK_OK}` });
    expect(WRITES_NEED_JACK_OK).toBe("writes need a separate Jack OK.");
    expect(parseReportCli(["--apply=yes"]).ok).toBe(false);
    expect(parseReportCli(["--bogus"]).ok).toBe(false);
  });

  it("the report recommends against inserting into org_people", () => {
    const text = formatLabelReport(buildLabelReport(prodShape()), { includePii: false });
    expect(text).toContain("Do NOT insert these contacts into org_people");
    expect(text).toContain("all rows are resolved");
    expect(text).toContain("Houses are numbers only");
  });

  it("script and helpers contain no write calls", () => {
    for (const file of ["scripts/missio-label-dry-run-report.ts", "src/lib/missio/label-dry-run-report.ts"]) {
      const source = readFileSync(resolve(__dirname, "../../..", file), "utf8");
      expect(source).not.toMatch(/\.(insert|update|delete|upsert|rpc)\s*\(/);
      expect(source).not.toMatch(/apply_migration/);
    }
    const script = readFileSync(resolve(__dirname, "../../../scripts/missio-label-dry-run-report.ts"), "utf8");
    // The only db.from() is inside readOnly(), which returns select alone.
    expect(script.match(/\.from\(/g)).toHaveLength(1);
    expect(script).toMatch(/db\.from\(table\)\.select\(columns\)/);
  });
});
