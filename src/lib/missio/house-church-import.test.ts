import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MISSIO_PROD_PROJECT_REF,
  applyHouseChurchImport,
  checkImportWriteGate,
  classifyHouseChurchRow,
  formatImportSummary,
  mapSheetRole,
  membershipIsCurrent,
  membershipIsOpen,
  normalizePersonName,
  parseHouseChurchCsv,
  parseImportCli,
  planHouseChurchImport,
  runHouseChurchImport,
  type ContactName,
  type ImportSnapshot,
  type ImportWriter,
} from "@/lib/missio/house-church-import";

const HOUSE_1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const HOUSE_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const ADA = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const GRACE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const ALAN_A = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const ALAN_B = "cccccccc-cccc-4ccc-8ccc-ccccccccccc4";
const JOSE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc5";

const contacts: ContactName[] = [
  { id: ADA, firstName: "Ada", lastName: "Lovelace", preferredName: null },
  { id: GRACE, firstName: "Ann", lastName: "Hopper", preferredName: "Grace" },
  { id: ALAN_A, firstName: "Alan", lastName: "Turing", preferredName: null },
  { id: ALAN_B, firstName: "Alan", lastName: "Turing", preferredName: "Al" },
  { id: JOSE, firstName: "Jose", lastName: "Obrien", preferredName: null },
];

function snapshot(over: Partial<ImportSnapshot> = {}): ImportSnapshot {
  return {
    houses: [
      { id: HOUSE_1, orgId: "missio", number: 1 },
      { id: HOUSE_2, orgId: "missio", number: 2 },
    ],
    contacts,
    members: [],
    reviews: [],
    orgPeopleContactIds: [],
    ...over,
  };
}

function recordingWriter() {
  const calls: string[] = [];
  const writer: ImportWriter = {
    async insertMember(link) {
      calls.push(`member:${link.contactId}`);
    },
    async insertOrgPerson(contactId) {
      calls.push(`org:${contactId}`);
    },
    async insertReview(review) {
      calls.push(`review:${review.sourceLine}`);
    },
    async updateReview(review) {
      calls.push(`review-update:${review.sourceLine}`);
    },
  };
  return { calls, writer };
}

describe("house church import planner", () => {
  it("normalizes case, spaces, diacritics, and apostrophes", () => {
    expect(normalizePersonName("  José   O'Brien ")).toBe("jose obrien");
    expect(normalizePersonName("O’Brien")).toBe("obrien");
    expect(normalizePersonName("ADA")).toBe("ada");
  });

  it("maps the sheet roles and rejects anything else", () => {
    expect(mapSheetRole("Leader 1")).toBe("leader");
    expect(mapSheetRole(" Leader 2 ")).toBe("co_leader");
    expect(mapSheetRole("Member")).toBe("member");
    expect(mapSheetRole("leader")).toBeNull();
    expect(mapSheetRole("Leader")).toBeNull();
  });

  it("auto-links one exact match, including a preferred name, and classifies the rest", () => {
    expect(classifyHouseChurchRow({ kind: "person", first: "Ada", last: "Lovelace" }, contacts)).toEqual({
      action: "link",
      contactId: ADA,
    });
    expect(classifyHouseChurchRow({ kind: "couple_split", first: "Grace", last: "Hopper" }, contacts)).toEqual({
      action: "link",
      contactId: GRACE,
    });
    expect(classifyHouseChurchRow({ kind: "person", first: "José", last: "O'Brien" }, contacts)).toEqual({
      action: "link",
      contactId: JOSE,
    });
    expect(classifyHouseChurchRow({ kind: "person", first: "Alan", last: "Turing" }, contacts)).toMatchObject({
      action: "review",
      matchType: "multiple",
    });
    expect(
      classifyHouseChurchRow({ kind: "person", first: "Alan", last: "Turing" }, contacts).action === "review"
        ? (classifyHouseChurchRow({ kind: "person", first: "Alan", last: "Turing" }, contacts) as { candidateContactIds: string[] })
            .candidateContactIds
        : []
    ).toEqual([ALAN_A, ALAN_B]);
    expect(classifyHouseChurchRow({ kind: "person", first: "Nobody", last: "Home" }, contacts)).toEqual({
      action: "review",
      matchType: "none",
      candidateContactIds: [],
    });
    expect(classifyHouseChurchRow({ kind: "family_label", first: "Ada", last: "Lovelace" }, contacts)).toMatchObject({
      action: "review",
      matchType: "family_label",
      candidateContactIds: [ADA],
    });
    expect(classifyHouseChurchRow({ kind: "first_only", first: "Grace", last: "Hopper" }, contacts)).toMatchObject({
      action: "review",
      matchType: "first_only",
    });
    expect(classifyHouseChurchRow({ kind: "person", first: "Ada", last: "" }, contacts)).toMatchObject({
      action: "review",
      matchType: "partial",
      candidateContactIds: [ADA],
    });
  });

  it("plans the sample sheet and reports org_people that would be created", () => {
    const csv = readFileSync(resolve(process.cwd(), "tests/fixtures/missio-house-churches.sample.csv"), "utf8");
    const parsed = parseHouseChurchCsv(csv);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const planned = planHouseChurchImport(parsed.rows, snapshot({ orgPeopleContactIds: [ADA] }));
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.summary).toMatchObject({
      autoLinked: 4,
      alreadyLinked: 0,
      roleConflicts: 0,
      orgPeopleToCreate: 2,
      resolvedLeftUntouched: 0,
    });
    expect(planned.plan.summary.toReviewByReason).toEqual({
      none: 0,
      multiple: 2,
      family_label: 1,
      first_only: 1,
      partial: 0,
    });
    expect(planned.plan.orgPeopleToCreate.sort()).toEqual([GRACE, JOSE].sort());
    expect(planned.plan.links.map((link) => [link.rawName, link.houseNumber, link.outcome, link.role])).toEqual([
      ["Ada Lovelace", 1, "insert", "leader"],
      ["Grace Hopper", 1, "insert", "co_leader"],
      ["Grace Hopper", 2, "insert", "member"],
      ["Jose Obrien", 1, "insert", "member"],
    ]);
    expect(planned.plan.reviews.map((review) => review.matchType).sort()).toEqual([
      "family_label",
      "first_only",
      "multiple",
      "multiple",
    ]);
    const text = formatImportSummary(planned.plan.summary, planned.plan.conflicts);
    expect(text).toContain("org_people to create: 2");
    expect(text).toContain("auto-linked: 4");
  });

  it("does not write on a dry run, and a second apply writes nothing", async () => {
    const csv = readFileSync(resolve(process.cwd(), "tests/fixtures/missio-house-churches.sample.csv"), "utf8");
    const parsed = parseHouseChurchCsv(csv);
    if (!parsed.ok) throw new Error(parsed.error);
    const db = snapshot({ orgPeopleContactIds: [ADA] });
    const dry = recordingWriter();
    const first = await runHouseChurchImport({ rows: parsed.rows, snapshot: db, apply: false, writer: dry.writer });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.wrote).toBe(0);
    expect(dry.calls).toEqual([]);

    const live = recordingWriter();
    const applied = await applyHouseChurchImport(first.plan, live.writer, { apply: true });
    expect(applied.wrote).toBeGreaterThan(0);
    expect(live.calls.some((call) => call.startsWith("member:"))).toBe(true);
    expect(live.calls.some((call) => call.startsWith("org:"))).toBe(true);
    expect(live.calls.some((call) => call.startsWith("review:"))).toBe(true);
    expect(live.calls.some((call) => call.startsWith("org:" + ADA))).toBe(false);

    for (const link of first.plan.links) {
      if (link.outcome === "insert") {
        db.members.push({
          houseChurchId: link.houseId,
          contactId: link.contactId,
          role: link.role,
          endedAt: null,
        });
      }
    }
    db.orgPeopleContactIds.push(...first.plan.orgPeopleToCreate);
    for (const review of first.plan.reviews) {
      db.reviews.push({
        sourceLine: review.sourceLine,
        rawName: review.rawName,
        status: "pending",
        houseNumber: review.houseNumber,
        role: review.role,
        kind: review.kind,
        matchType: review.matchType,
        candidateContactIds: review.candidateContactIds,
      });
    }

    const againWriter = recordingWriter();
    const second = await runHouseChurchImport({
      rows: parsed.rows,
      snapshot: db,
      apply: true,
      writer: againWriter.writer,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.wrote).toBe(0);
    expect(againWriter.calls).toEqual([]);
    expect(second.plan.summary.autoLinked).toBe(0);
    expect(second.plan.summary.alreadyLinked).toBe(4);
    expect(second.plan.summary.orgPeopleToCreate).toBe(0);
    expect(second.plan.reviews.every((review) => review.outcome === "unchanged")).toBe(true);
  });

  it("reports a role conflict and does not change the active role", async () => {
    const rows = parseHouseChurchCsv(
      [
        "source_line,house,role,raw_name,first,last,people_count_on_row,kind,note,part_index,parts_in_row",
        "1,1,Leader 1,Ada Lovelace,Ada,Lovelace,1,person,,1,1",
      ].join("\n")
    );
    if (!rows.ok) throw new Error(rows.error);
    const db = snapshot({
      members: [{ houseChurchId: HOUSE_1, contactId: ADA, role: "member", endedAt: null }],
      orgPeopleContactIds: [ADA],
    });
    const writer = recordingWriter();
    const result = await runHouseChurchImport({ rows: rows.rows, snapshot: db, apply: true, writer: writer.writer });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.summary.roleConflicts).toBe(1);
    expect(result.plan.summary.autoLinked).toBe(0);
    expect(result.plan.conflicts).toEqual([
      { sourceLine: 1, houseNumber: 1, sheetRole: "leader", existingRole: "member" },
    ]);
    expect(writer.calls).toEqual([]);
    expect(db.members[0].role).toBe("member");
  });

  it("treats a past end as a new link, and a future end as still current", async () => {
    expect(membershipIsOpen({ endedAt: null })).toBe(true);
    expect(membershipIsCurrent({ startedAt: "2026-01-01", endedAt: null }, "2026-11-18")).toBe(true);
    expect(membershipIsCurrent({ startedAt: "2026-01-01", endedAt: "2099-01-01" }, "2026-11-18")).toBe(true);
    expect(membershipIsCurrent({ startedAt: "2026-01-01", endedAt: "2026-11-18" }, "2026-11-18")).toBe(false);
    expect(membershipIsCurrent({ startedAt: "2099-01-01", endedAt: null }, "2026-11-18")).toBe(false);

    const future = parseHouseChurchCsv(
      [
        "source_line,house,role,raw_name,first,last,people_count_on_row,kind,note,part_index,parts_in_row",
        "1,1,Leader 1,Ada Lovelace,Ada,Lovelace,1,person,,1,1",
      ].join("\n")
    );
    if (!future.ok) throw new Error(future.error);
    const blocked = planHouseChurchImport(
      future.rows,
      snapshot({
        members: [
          {
            houseChurchId: HOUSE_1,
            contactId: ADA,
            role: "member",
            startedAt: "2026-01-01",
            endedAt: "2099-01-01",
          },
        ],
      })
    );
    expect(blocked.ok).toBe(true);
    if (!blocked.ok) return;
    expect(blocked.plan.links[0].outcome).toBe("role_conflict");
    expect(blocked.plan.summary.autoLinked).toBe(0);
  });

  it("treats an ended membership as a new link and refuses a missing house before any write", async () => {
    const ended = parseHouseChurchCsv(
      [
        "source_line,house,role,raw_name,first,last,people_count_on_row,kind,note,part_index,parts_in_row",
        "9,1,Member,Ada Lovelace,Ada,Lovelace,1,person,,1,1",
      ].join("\n")
    );
    if (!ended.ok) throw new Error(ended.error);
    const planned = planHouseChurchImport(
      ended.rows,
      snapshot({
        members: [
          {
            houseChurchId: HOUSE_1,
            contactId: ADA,
            role: "leader",
            startedAt: "2020-01-01",
            endedAt: "2020-06-01",
          },
        ],
      })
    );
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.links[0].outcome).toBe("insert");

    const missing = parseHouseChurchCsv(
      [
        "source_line,house,role,raw_name,first,last,people_count_on_row,kind,note,part_index,parts_in_row",
        "1,99,Member,Ada Lovelace,Ada,Lovelace,1,person,,1,1",
      ].join("\n")
    );
    if (!missing.ok) throw new Error(missing.error);
    const writer = recordingWriter();
    const refused = await runHouseChurchImport({
      rows: missing.rows,
      snapshot: snapshot(),
      apply: true,
      writer: writer.writer,
    });
    expect(refused.ok).toBe(false);
    expect(writer.calls).toEqual([]);
    if (refused.ok) return;
    expect(refused.message).toContain("99");
  });

  it("leaves a resolved review row alone and still queues a new pending one", () => {
    const parsed = parseHouseChurchCsv(
      [
        "source_line,house,role,raw_name,first,last,people_count_on_row,kind,note,part_index,parts_in_row",
        "4,2,Member,The Turing Family,The Turing Family,,3,family_label,label,1,1",
        "5,2,Member,Alan,Alan,,1,first_only,,1,1",
      ].join("\n")
    );
    if (!parsed.ok) throw new Error(parsed.error);
    const planned = planHouseChurchImport(
      parsed.rows,
      snapshot({
        reviews: [
          {
            sourceLine: 4,
            rawName: "The Turing Family",
            status: "skipped",
            houseNumber: 2,
            role: "member",
            kind: "family_label",
            matchType: "family_label",
            candidateContactIds: [],
          },
        ],
      })
    );
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.reviews.map((review) => [review.rawName, review.outcome])).toEqual([
      ["The Turing Family", "leave_resolved"],
      ["Alan", "insert"],
    ]);
    expect(planned.plan.summary.resolvedLeftUntouched).toBe(1);
    expect(planned.plan.summary.toReviewByReason.first_only).toBe(1);
    expect(planned.plan.summary.toReviewByReason.family_label).toBe(0);
  });

  it("rejects a bad role, a repeated key, and a quoted comma", () => {
    const badRole = parseHouseChurchCsv(
      "source_line,house,role,raw_name,first,last,people_count_on_row,kind,note,part_index,parts_in_row\n1,1,leader,Ada,Ada,Lovelace,1,person,,1,1"
    );
    expect(badRole.ok).toBe(false);
    const repeated = parseHouseChurchCsv(
      [
        "source_line,house,role,raw_name,first,last,people_count_on_row,kind,note,part_index,parts_in_row",
        "1,1,Member,Ada,Ada,Lovelace,1,person,,1,1",
        "1,2,Member,Ada,Ada,Lovelace,1,person,,1,1",
      ].join("\n")
    );
    expect(repeated.ok).toBe(false);
    const quoted = parseHouseChurchCsv(
      'source_line,house,role,raw_name,first,last,people_count_on_row,kind,note,part_index,parts_in_row\n1,1,Member,"Ada, Lovelace",Ada,Lovelace,1,person,"note, with comma",1,1'
    );
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) return;
    expect(quoted.rows[0].rawName).toBe("Ada, Lovelace");
    expect(quoted.rows[0].note).toBe("note, with comma");
  });
});

describe("import write gate", () => {
  const url = `https://${MISSIO_PROD_PROJECT_REF}.supabase.co`;

  it("parses the flags and refuses a prod write without approval", () => {
    expect(parseImportCli(["houses.csv"])).toMatchObject({ ok: true, apply: false, projectRef: null });
    expect(parseImportCli(["houses.csv", "--apply", "--project-ref", "abc"])).toMatchObject({
      ok: true,
      apply: true,
      projectRef: "abc",
    });
    expect(parseImportCli(["--apply", "--project-ref=abc", "houses.csv", "--i-have-approval-for-prod"])).toMatchObject({
      ok: true,
      apply: true,
      projectRef: "abc",
      approveProd: true,
    });
    expect(parseImportCli(["--nope"])).toMatchObject({ ok: false });
    expect(parseImportCli([])).toMatchObject({ ok: false });

    expect(checkImportWriteGate({ apply: false, projectRef: null, supabaseUrl: url, approveProd: false })).toEqual({
      ok: true,
    });
    expect(
      checkImportWriteGate({ apply: true, projectRef: null, supabaseUrl: url, approveProd: false }).ok
    ).toBe(false);
    expect(
      checkImportWriteGate({ apply: true, projectRef: "other", supabaseUrl: url, approveProd: true }).ok
    ).toBe(false);
    expect(
      checkImportWriteGate({ apply: true, projectRef: MISSIO_PROD_PROJECT_REF, supabaseUrl: url, approveProd: false }).ok
    ).toBe(false);
    expect(
      checkImportWriteGate({
        apply: true,
        projectRef: "devref",
        supabaseUrl: "https://devref.supabase.co",
        approveProd: false,
      })
    ).toEqual({ ok: true });
    expect(
      checkImportWriteGate({
        apply: true,
        projectRef: MISSIO_PROD_PROJECT_REF,
        supabaseUrl: url,
        approveProd: true,
      })
    ).toEqual({ ok: true });
  });
});
