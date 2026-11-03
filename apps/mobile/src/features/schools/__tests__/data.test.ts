jest.mock("@/lib/supabase", () => ({ supabase: {} }));

// eslint-disable-next-line import/first
import { DataError, hasEnrolment, loadAttendance, loadEnrolment, loadErrorMessage, loadSchools } from "../data";
// eslint-disable-next-line import/first
import { strings } from "../strings";

type Result = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };

/** A tiny PostgREST stand-in: records the chain, answers per table. */
function fakeDb(answers: Record<string, Result>) {
  const log: { table: string; calls: [string, ...unknown[]][] }[] = [];
  return {
    log,
    calls: (table: string) => log.filter((l) => l.table === table).flatMap((l) => l.calls),
    client: {
      from(table: string) {
        const entry = { table, calls: [] as [string, ...unknown[]][] };
        log.push(entry);
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "is", "order", "maybeSingle"]) {
          chain[m] = (...args: unknown[]) => {
            entry.calls.push([m, ...args]);
            return chain;
          };
        }
        chain.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(answers[table] ?? { data: [], error: null }).then(resolve, reject);
        return chain;
      },
    } as never,
  };
}

const ID = "11111111-2222-4333-8444-555555555555";
const selectOf = (calls: [string, ...unknown[]][]) => String(calls.find((c) => c[0] === "select")?.[1]);

describe("My Schools list", () => {
  it("only the caller's own enrolments and applications; embeds flattened; bad rows skipped", async () => {
    const db = fakeDb({
      enrollments: {
        data: [
          { id: "e1", status: "active", enrolled_at: "2026-07-01", programs: [{ id: "p1", name: "DTS", code: "DTS", credit_hours: 12 }], assigned_staff: null },
          { id: 5 },
        ],
        error: null,
      },
      application_responses: { data: [{ id: "a1", program_id: "p1", status: "accepted", submitted_at: null, programs: { id: "p1", name: "DTS", code: "DTS" } }], error: null },
      programs: { data: [{ id: "p2", name: "SBS", code: "SBS", credit_hours: 8 }], error: null },
    });
    const out = await loadSchools("u1", db.client);
    expect(out.enrolments).toHaveLength(1);
    expect(out.enrolments[0].programs?.name).toBe("DTS");
    expect(out.applications[0].status).toBe("accepted");
    expect(out.openProgrammes[0].id).toBe("p2");

    expect(db.calls("enrollments")).toEqual(expect.arrayContaining([["eq", "user_id", "u1"], ["is", "removed_at", null]]));
    expect(db.calls("application_responses")).toContainEqual(["eq", "user_id", "u1"]);
    expect(db.calls("programs")).toEqual(expect.arrayContaining([["eq", "application_open", true], ["eq", "status", "active"]]));
  });

  it("never asks for staff-only columns (no '*', no notes)", async () => {
    const db = fakeDb({});
    await loadSchools("u1", db.client);
    for (const t of ["enrollments", "application_responses", "programs"]) {
      const sel = selectOf(db.calls(t));
      expect(sel).not.toContain("*");
      expect(sel).not.toMatch(/notes/);
    }
  });

  it("a failed read is a plain-English error", async () => {
    const db = fakeDb({ enrollments: { data: null, error: { message: "TypeError: Network request failed" } } });
    await expect(loadSchools("u1", db.client)).rejects.toEqual(new DataError(strings.common.network));
    const db2 = fakeDb({ programs: { data: null, error: { message: "boom" } } });
    await expect(loadSchools("u1", db2.client)).rejects.toEqual(new DataError(strings.common.generic));
  });

  it("a refused read says it isn't available on this account", async () => {
    const db = fakeDb({ enrollments: { data: null, error: { message: "permission denied", code: "42501" } } });
    const err = await loadSchools("u1", db.client).catch((e: unknown) => e);
    expect(loadErrorMessage(err)).toBe(strings.common.forbidden);
    expect(loadErrorMessage(new Error("x"))).toBe(strings.common.generic);
  });
});

describe("Home shortcut check", () => {
  it("counts only the caller's current enrolments, without fetching rows", async () => {
    const db = fakeDb({ enrollments: { data: null, error: null, count: 2 } });
    expect(await hasEnrolment("u1", db.client)).toBe(true);
    expect(db.calls("enrollments")).toEqual(
      expect.arrayContaining([["select", "id", { count: "exact", head: true }], ["eq", "user_id", "u1"], ["is", "removed_at", null]]),
    );
    expect(await hasEnrolment("u1", fakeDb({ enrollments: { data: null, error: null, count: 0 } }).client)).toBe(false);
    await expect(hasEnrolment("u1", fakeDb({ enrollments: { data: null, error: { message: "x" } } }).client)).rejects.toBeInstanceOf(DataError);
  });
});

describe("One enrolment", () => {
  const row = {
    id: ID,
    status: "active",
    enrolled_at: "2026-07-01",
    completed_at: null,
    programs: { id: "p1", name: "DTS", code: "DTS", credit_hours: 12, courses: [{ id: "c1", name: "Lecture", code: "L", credit_hours: 6, sequence: 1 }, { bad: true }] },
    assigned_staff: [{ first_name: "Ann", last_name: "Lee", preferred_name: null, email: null }],
  };

  it("filtered to the id AND the caller, with its grades", async () => {
    const db = fakeDb({ enrollments: { data: row, error: null }, grades: { data: [{ course_id: "c1", letter_grade: "A" }], error: null } });
    const out = await loadEnrolment("u1", ID, db.client);
    expect(out?.enrolment.programs?.courses.map((c) => c.id)).toEqual(["c1"]);
    expect(out?.enrolment.assigned_staff?.first_name).toBe("Ann");
    expect(out?.grades).toEqual([{ course_id: "c1", letter_grade: "A" }]);
    expect(db.calls("enrollments")).toEqual(expect.arrayContaining([["eq", "id", ID], ["eq", "user_id", "u1"], ["is", "removed_at", null], ["maybeSingle"]]));
    expect(db.calls("grades")).toContainEqual(["eq", "enrollment_id", ID]);
    expect(selectOf(db.calls("grades"))).toBe("course_id, letter_grade");
  });

  it("someone else's (or a removed) enrolment comes back as not found", async () => {
    const db = fakeDb({ enrollments: { data: null, error: null } });
    expect(await loadEnrolment("u1", ID, db.client)).toBeNull();
  });

  it("errors are thrown, not shown as 'not found'", async () => {
    const db = fakeDb({ enrollments: { data: null, error: { message: "boom" } } });
    await expect(loadEnrolment("u1", ID, db.client)).rejects.toBeInstanceOf(DataError);
  });
});

describe("My Attendance", () => {
  it("looks up the caller's contact, then only that contact's records", async () => {
    const db = fakeDb({
      users: { data: { contact_id: "ct1" }, error: null },
      attendance_records: { data: [{ id: "r1", status: "present", checked_in_at: null, events: { id: "e1", title: "Lecture", start_date: "2026-11-03", location: null } }, { nope: 1 }], error: null },
    });
    const out = await loadAttendance("u1", db.client);
    expect(out.map((r) => r.id)).toEqual(["r1"]);
    expect(db.calls("users")).toContainEqual(["eq", "id", "u1"]);
    expect(db.calls("attendance_records")).toContainEqual(["eq", "contact_id", "ct1"]);
  });

  it("no contact on the profile: no records, and no attendance query at all", async () => {
    const db = fakeDb({ users: { data: { contact_id: null }, error: null } });
    expect(await loadAttendance("u1", db.client)).toEqual([]);
    expect(db.log.map((l) => l.table)).toEqual(["users"]);
  });

  it("a failed read throws", async () => {
    const db = fakeDb({ users: { data: { contact_id: "ct1" }, error: null }, attendance_records: { data: null, error: { message: "boom" } } });
    await expect(loadAttendance("u1", db.client)).rejects.toBeInstanceOf(DataError);
  });
});
