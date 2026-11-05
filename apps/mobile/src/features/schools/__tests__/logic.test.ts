import { makeMe } from "../../../../test/fixtures";
import { course, programme } from "../__fixtures__/fixtures";
import {
  ENROLLED_STATUSES,
  applicationStatus,
  canSeeMySchools,
  countsAsEnrolled,
  attendanceStatus,
  courseTiming,
  dayAndMonth,
  enrolmentStatus,
  formatDate,
  formatRange,
  formatTime,
  gradeToPoints,
  hasSchoolsModule,
  humanise,
  isUuid,
  nextArrival,
  notYetApplied,
  schoolsAccess,
  staffName,
  summariseAttendance,
  summariseGrades,
  todayISO,
} from "../logic";

const perm = (key: string) => ({ key, scopeType: null, scopeId: null, source: "role" });

describe("status words", () => {
  it("known statuses read as the web's words, with a tone", () => {
    expect(enrolmentStatus("waiting_for_arrival")).toEqual({ label: "Waiting for arrival", tone: "attention" });
    expect(enrolmentStatus("active")).toEqual({ label: "Active", tone: "positive" });
    expect(enrolmentStatus("withdrawn").tone).toBe("danger");
    expect(applicationStatus("rejected")).toEqual({ label: "Not accepted", tone: "danger" });
    expect(applicationStatus("waiting_for_references").label).toBe("Awaiting references");
    expect(attendanceStatus("late")).toEqual({ label: "Late", tone: "attention" });
    expect(attendanceStatus("absent").label).toBe("Absent");
  });

  it("an unknown status still reads as words, never a code", () => {
    expect(enrolmentStatus("some_new_state")).toEqual({ label: "Some new state", tone: "default" });
    expect(attendanceStatus("remote")).toEqual({ label: "Remote", tone: "default" });
    expect(humanise("")).toBe("");
  });
});

describe("dates", () => {
  it("formats dates and timestamps as a day, never an hour off", () => {
    expect(formatDate("2027-01-12")).toBe("12 Jan 2027");
    expect(formatDate("2026-07-01T23:30:00.000Z")).toBe("1 Jul 2026");
    expect(formatDate(null)).toBeNull();
    expect(formatDate("soon")).toBeNull();
    expect(formatDate("2026-13-01")).toBeNull();
  });

  it("ranges drop the repeated year", () => {
    expect(formatRange("2026-07-01", "2026-09-30")).toBe("1 Jul – 30 Sep 2026");
    expect(formatRange("2026-12-01", "2027-02-28")).toBe("1 Dec 2026 – 28 Feb 2027");
    expect(formatRange("2026-07-01", null)).toBe("From 1 Jul 2026");
    expect(formatRange(null, "2026-07-01")).toBe("Until 1 Jul 2026");
    expect(formatRange(null, null)).toBeNull();
  });

  it("date block and time", () => {
    expect(dayAndMonth("2026-11-03")).toEqual({ day: "03", mon: "NOV" });
    expect(dayAndMonth(undefined as unknown as null)).toBeNull();
    const t = new Date(2026, 10, 3, 8, 5);
    expect(formatTime(t.toISOString())).toBe("08:05");
    expect(formatTime("nope")).toBeNull();
    expect(formatTime(null)).toBeNull();
    expect(todayISO(new Date(2026, 0, 9))).toBe("2026-01-09");
  });

  it("only uuids count as enrolment ids", () => {
    expect(isUuid("11111111-2222-4333-8444-555555555555")).toBe(true);
    expect(isUuid("abc")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});

describe("people and applications", () => {
  it("staff name like the web: name, else email", () => {
    expect(staffName({ first_name: "Ann", last_name: "Lee", preferred_name: null, email: "a@x" })).toBe("Ann Lee");
    expect(staffName({ first_name: null, last_name: null, preferred_name: null, email: "a@x" })).toBe("a@x");
    expect(staffName({ first_name: null, last_name: null, preferred_name: null, email: null })).toBeNull();
    expect(staffName(null)).toBeNull();
  });

  it("open schools not yet applied to", () => {
    const open = [programme({ id: "p1" }), programme({ id: "p2", name: "SBS" })];
    expect(notYetApplied(open, [{ program_id: "p1" }]).map((p) => p.id)).toEqual(["p2"]);
    expect(notYetApplied(open, [])).toHaveLength(2);
  });
});

describe("grades (same maths as the web)", () => {
  it("grade points", () => {
    expect(gradeToPoints("A-")).toBe(3.7);
    expect(gradeToPoints("P")).toBeNull();
  });

  it("GPA weighted by credits; W/I/P don't count; F is attempted but not earned", () => {
    const courses = [
      course({ id: "a", credit_hours: 3, sequence: 2 }),
      course({ id: "b", credit_hours: 1, sequence: 1 }),
      course({ id: "c", credit_hours: 2, sequence: 3 }),
      course({ id: "d", credit_hours: 4, sequence: 4 }),
      course({ id: "e", credit_hours: 5, sequence: 5 }),
    ];
    const s = summariseGrades(courses, [
      { course_id: "a", letter_grade: "A" },
      { course_id: "b", letter_grade: "B" },
      { course_id: "c", letter_grade: "F" },
      { course_id: "d", letter_grade: "P" },
      { course_id: "e", letter_grade: null },
    ]);
    // (4*3 + 3*1 + 0*2) / 6 = 2.5
    expect(s.gpa).toBe(2.5);
    expect(s.creditsAttempted).toBe(10);
    expect(s.creditsEarned).toBe(8);
    // Ordered by sequence.
    expect(s.courses.map((c) => c.id)).toEqual(["b", "a", "c", "d", "e"]);
    expect(s.courses[4].letterGrade).toBeNull();
  });

  it("nothing graded: no GPA", () => {
    expect(summariseGrades([course()], []).gpa).toBeNull();
  });
});

describe("now / next and arrival", () => {
  const courses = [
    course({ id: "c1", start_date: "2026-07-01", end_date: "2026-09-30", arrival_date: "2026-06-30" }),
    course({ id: "c2", start_date: "2026-10-01", end_date: "2026-12-15", arrival_date: "2026-11-20" }),
    course({ id: "c3", start_date: null, end_date: null }),
  ];

  it("marks the running course and the next one", () => {
    const m = courseTiming(courses, "2026-08-10");
    expect(m.get("c1")).toBe("now");
    expect(m.get("c2")).toBe("next");
    expect(m.has("c3")).toBe(false);
  });

  it("before the school: only next; after it: nothing", () => {
    expect([...courseTiming(courses, "2026-01-01")]).toEqual([["c1", "next"]]);
    expect(courseTiming(courses, "2027-06-01").size).toBe(0);
  });

  it("arrival shows only while it's still ahead", () => {
    expect(nextArrival(courses, "2026-01-01")).toBe("2026-06-30");
    expect(nextArrival(courses, "2026-10-05")).toBe("2026-11-20");
    // Running course's arrival is past, but the next course's is ahead.
    expect(nextArrival(courses, "2026-08-10")).toBe("2026-11-20");
    // In the last course, after its arrival: nothing.
    expect(nextArrival(courses, "2026-11-25")).toBeNull();
  });
});

describe("attendance summary", () => {
  it("counts present like the web (late is its own word), in a fixed order", () => {
    const s = summariseAttendance([{ status: "absent" }, { status: "present" }, { status: "late" }, { status: "present" }, { status: "odd" }]);
    expect(s).toMatchObject({ total: 5, present: 2, pct: 40 });
    expect(s.byStatus.map((b) => `${b.label} ${b.count}`)).toEqual(["Present 2", "Late 1", "Absent 1", "Odd 1"]);
  });

  it("no records: no percentage", () => {
    expect(summariseAttendance([])).toEqual({ total: 0, present: 0, pct: null, byStatus: [] });
  });
});

describe("Who sees My Schools in the app (UX only)", () => {
  const role = (name: string) => makeMe({ roles: [{ name, scopeType: null, scopeId: null }], permissions: [] });
  const nobody = makeMe({ roles: [], permissions: [] });
  const ties = (enrolmentStatuses: string[], assignedStaff = false) => ({ enrolmentStatuses, assignedStaff });

  it.each([
    ["waiting_for_arrival", true],
    ["arrived", true],
    ["graduated", true],
    ["active", true],
    ["on_hold", true],
    ["completed", true],
    ["dismissed", false],
    ["decided_to_leave", false],
    ["withdrawn", false],
    ["something_new", false],
  ])("enrolment status %s counts: %s", (status, expected) => {
    expect(countsAsEnrolled(status)).toBe(expected);
    expect(canSeeMySchools({ me: nobody, ties: ties([status]) })).toBe(expected);
  });

  it("every status the app labels is decided on purpose", () => {
    expect([...ENROLLED_STATUSES].sort()).toEqual(["active", "arrived", "completed", "graduated", "on_hold", "waiting_for_arrival"]);
  });

  it("one enrolment that counts is enough, whatever the others say", () => {
    expect(canSeeMySchools({ me: nobody, ties: ties(["dismissed", "arrived"]) })).toBe(true);
  });

  it.each([
    ["admin", role("admin"), true],
    ["super_admin", role("super_admin"), true],
    ["program_leader", role("program_leader"), true],
    ["any schools.* permission", makeMe({ roles: [], permissions: [perm("schools.view")] }), true],
    ["plain staff role", role("staff"), false],
    ["finance_admin", role("finance_admin"), false],
    ["nobody", nobody, false],
    ["not loaded yet", null, false],
  ])("Training module, no enrolment: %s -> %s", (_label, me, expected) => {
    expect(hasSchoolsModule(me)).toBe(expected);
    expect(canSeeMySchools({ me, ties: ties([]) })).toBe(expected);
  });

  it("assigned staff on an enrolment count as school staff", () => {
    expect(canSeeMySchools({ me: nobody, ties: ties([], true) })).toBe(true);
    expect(canSeeMySchools({ me: null, ties: ties(["dismissed"], true) })).toBe(true);
  });

  it("applicants with no enrolment, and people we haven't asked about yet, don't", () => {
    expect(canSeeMySchools({ me: nobody, ties: ties([]) })).toBe(false);
    expect(canSeeMySchools({ me: nobody, ties: null })).toBe(false);
  });

  it("access: module or a yes allows at once; waits for /api/me before saying no", () => {
    expect(schoolsAccess({ me: role("admin"), meLoading: false, tiesAnswer: undefined })).toBe("allowed");
    expect(schoolsAccess({ me: null, meLoading: true, tiesAnswer: true })).toBe("allowed");
    expect(schoolsAccess({ me: nobody, meLoading: false, tiesAnswer: undefined })).toBe("checking");
    expect(schoolsAccess({ me: null, meLoading: true, tiesAnswer: false })).toBe("checking");
    expect(schoolsAccess({ me: nobody, meLoading: false, tiesAnswer: false })).toBe("notAllowed");
    expect(schoolsAccess({ me: null, meLoading: false, tiesAnswer: false })).toBe("notAllowed");
    expect(schoolsAccess({ me: nobody, meLoading: false, tiesAnswer: null })).toBe("unknown");
  });
});
