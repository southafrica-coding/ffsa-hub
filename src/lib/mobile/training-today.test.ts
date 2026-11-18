import { describe, expect, it } from "vitest";
import type { NameRow } from "@/lib/mobile/training";
import { buildToday, isoWeek, rand, type TodayStudent } from "@/lib/mobile/training-today";

const names = new Map<string, NameRow>([
  ["grace", { id: "grace", first_name: "Grace", last_name: "M", preferred_name: null }],
  ["sipho", { id: "sipho", first_name: "Sipho", last_name: "D", preferred_name: null }],
  ["joel", { id: "joel", first_name: "Joel", last_name: "A", preferred_name: null }],
  ["ruth", { id: "ruth", first_name: "Ruth", last_name: "M", preferred_name: null }],
]);
const st = (over: Partial<TodayStudent>): TodayStudent => ({
  enrollmentId: "e-grace",
  userId: "grace",
  programId: "p1",
  programName: "FFX Sep 2026",
  status: "arrived",
  walkingWithMe: false,
  lastWeekOf: "2026-11-16",
  ...over,
});
const base = {
  me: "kim",
  today: "2026-11-23",
  weekOf: "2026-11-23",
  manages: new Set<string>(),
  students: [] as TodayStudent[],
  care: [],
  applications: [],
  references: [],
  ungraded: [],
  overdue: [],
  names,
  dismissed: new Set<string>(),
};

describe("isoWeek and rand", () => {
  it("numbers weeks the ISO way, across the year end", () => {
    expect(isoWeek("2026-11-23")).toBe("2026-W48");
    expect(isoWeek("2026-12-28")).toBe("2026-W53");
    expect(isoWeek("2027-01-04")).toBe("2027-W01");
    expect(isoWeek("2025-12-29")).toBe("2026-W01");
  });
  it("formats rand with a comma", () => {
    expect(rand(18400)).toBe("R 18,400");
    expect(rand(315881)).toBe("R 315,881");
    expect(rand(99.5)).toBe("R 99.50");
  });
});

describe("buildToday", () => {
  it("a walker gets one line per overdue student they walk with, and the care flag first", () => {
    const out = buildToday({
      ...base,
      me: "daniel",
      students: [
        st({ walkingWithMe: true, lastWeekOf: "2026-11-09" }),
        st({ enrollmentId: "e-joel", userId: "joel", walkingWithMe: true, lastWeekOf: "2026-11-16" }),
        st({ enrollmentId: "e-sipho", userId: "sipho", walkingWithMe: true, lastWeekOf: null }),
        st({ enrollmentId: "e-new", userId: "joel", walkingWithMe: true, status: "waiting_for_arrival", lastWeekOf: null }),
      ],
      care: [{ checkinId: "c1", enrollmentId: "e-joel", authorId: "ruth", createdAt: "2026-11-22T10:00:00Z" }],
    });
    expect(out.items.map((i) => i.title)).toEqual(["Ruth flagged Joel", "Check in with Grace", "Check in with Sipho"]);
    expect(out.items[1].meta).toBe("14 days since the last one");
    expect(out.items[2].meta).toMatch(/No check-in yet/);
    expect(out.band).toBe("care:c1");
    expect(out.open).toBe(3);
  });

  it("my own care flag isn't a to-do for me", () => {
    const out = buildToday({
      ...base,
      me: "daniel",
      students: [st({ walkingWithMe: true })],
      care: [{ checkinId: "c1", enrollmentId: "e-grace", authorId: "daniel", createdAt: "2026-11-22T10:00:00Z" }],
    });
    expect(out.items).toEqual([]);
    expect(out.band).toBeNull();
  });

  it("a leader gets counts for their school only", () => {
    const out = buildToday({
      ...base,
      manages: new Set(["p1"]),
      students: [
        st({ lastWeekOf: null }),
        st({ enrollmentId: "e-sipho", userId: "sipho", lastWeekOf: "2026-11-02" }),
        st({ enrollmentId: "e-other", userId: "joel", programId: "p2", lastWeekOf: null }),
      ],
      applications: [
        { programId: "p1", programName: "FFX Sep 2026", status: "interview_scheduled", submittedAt: "2026-11-10T08:00:00Z" },
        { programId: "p1", programName: "FFX Sep 2026", status: "submitted", submittedAt: "2026-11-20T08:00:00Z" },
        { programId: "p1", programName: "FFX Sep 2026", status: "waiting_for_references", submittedAt: "2026-10-01T08:00:00Z" },
        { programId: "p2", programName: "Other", status: "submitted", submittedAt: "2026-10-01T08:00:00Z" },
      ],
      references: [{ programId: "p1", programName: "FFX Sep 2026", since: "2026-11-12T08:00:00Z" }],
      ungraded: [{ programId: "p1", courseCode: "INT 202", courseName: "Intercession", endDate: "2026-11-20", ungraded: 9, arrived: 28 }],
      overdue: [
        { programId: "p1", programName: "FFX Sep 2026", owed: 12200, enrollmentId: "e-a" },
        { programId: "p1", programName: "FFX Sep 2026", owed: 6200, enrollmentId: "e-b" },
        { programId: "p2", programName: "Other", owed: 999, enrollmentId: "e-c" },
      ],
    });
    expect(out.items.map((i) => i.title)).toEqual([
      "2 students haven't had a check-in for 2 weeks",
      "1 applicant has waited more than a week",
      "Grade INT 202",
      "1 reference is more than a week late",
      "Chase 2 fee balances",
    ]);
    expect(out.items[4].meta).toBe("R 18,400 overdue · FFX Sep 2026");
    expect(out.items[2].meta).toBe("9 of 28 ungraded · ended 2026-11-20");
  });

  it("ticked items sink to the bottom and never become the band", () => {
    const out = buildToday({
      ...base,
      me: "daniel",
      students: [st({ walkingWithMe: true, lastWeekOf: null })],
      care: [{ checkinId: "c1", enrollmentId: "e-grace", authorId: "ruth", createdAt: "2026-11-22T10:00:00Z" }],
      dismissed: new Set(["care:c1"]),
    });
    expect(out.items.map((i) => [i.key, i.done])).toEqual([
      ["checkin:e-grace:2026-W48", false],
      ["care:c1", true],
    ]);
    expect(out.band).toBe("checkin:e-grace:2026-W48");
    expect(out.open).toBe(1);
  });
});
