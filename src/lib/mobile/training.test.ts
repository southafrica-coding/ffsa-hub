import { describe, expect, it } from "vitest";
import {
  buildJourney,
  parseCheckinBody,
  saToday,
  shapeStudents,
  studentStatus,
  weekOf,
  type CheckinRow,
  type NameRow,
} from "@/lib/mobile/training";

const E1 = "e1000000-0000-4000-8000-000000000001";
const names = new Map<string, NameRow>([
  ["grace", { id: "grace", first_name: "Grace", last_name: "Mwangi", preferred_name: null }],
  ["sipho", { id: "sipho", first_name: "Sipho", last_name: "Dlamini", preferred_name: null }],
  ["daniel", { id: "daniel", first_name: "Daniel", last_name: "Pretorius", preferred_name: null }],
  ["ruth", { id: "ruth", first_name: "Ruth", last_name: "Malan", preferred_name: null }],
]);
const checkin = (over: Partial<CheckinRow>): CheckinRow => ({
  id: "c1",
  enrollment_id: "e-grace",
  week_of: "2026-11-09",
  by_user_id: "daniel",
  contact: "met",
  mood: "okay",
  note_for_student: "Proud of you",
  needs_care: false,
  care_taken_by: null,
  care_taken_at: null,
  created_at: "2026-11-09T12:00:00Z",
  ...over,
});

describe("dates in South Africa", () => {
  it("week starts on Monday, in SAST", () => {
    expect(weekOf(new Date("2026-11-25T10:00:00Z"))).toBe("2026-11-23"); // Wednesday
    expect(weekOf(new Date("2026-11-22T21:30:00Z"))).toBe("2026-11-16"); // Sun 21:30 UTC = Sun 23:30 SAST
    expect(weekOf(new Date("2026-11-22T22:30:00Z"))).toBe("2026-11-23"); // = Mon 00:30 SAST
    expect(weekOf(new Date("2026-11-23T21:59:00Z"))).toBe("2026-11-23"); // Mon 23:59 SAST
    expect(saToday(new Date("2026-11-22T22:30:00Z"))).toBe("2026-11-23");
  });
});

describe("studentStatus", () => {
  const today = "2026-11-23";
  it("care first, then arriving, then overdue at 14 days", () => {
    expect(studentStatus({ enrollmentStatus: "arrived", lastWeekOf: "2026-11-23", openCare: true, today })).toBe("needs_care");
    expect(studentStatus({ enrollmentStatus: "waiting_for_arrival", lastWeekOf: null, openCare: false, today })).toBe("arriving");
    expect(studentStatus({ enrollmentStatus: "arrived", lastWeekOf: null, openCare: false, today })).toBe("no_checkin");
    expect(studentStatus({ enrollmentStatus: "arrived", lastWeekOf: "2026-11-09", openCare: false, today })).toBe("no_checkin");
    expect(studentStatus({ enrollmentStatus: "arrived", lastWeekOf: "2026-11-16", openCare: false, today })).toBe("on_track");
  });
});

describe("shapeStudents", () => {
  it("orders needs care, no check-in, on track, arriving; marks who I walk with", () => {
    const out = shapeStudents({
      me: "daniel",
      today: "2026-11-23",
      enrolments: [
        { id: "e-sipho", user_id: "sipho", program_id: "p1", status: "arrived", enrolled_at: null, programs: { name: "FFX Sep 2026", code: null } },
        { id: "e-grace", user_id: "grace", program_id: "p1", status: "arrived", enrolled_at: null, programs: [{ name: "FFX Sep 2026", code: null }] },
      ],
      walkers: [
        { enrollment_id: "e-grace", user_id: "daniel" },
        { enrollment_id: "e-grace", user_id: "ruth" },
      ],
      checkins: [checkin({ needs_care: true }), checkin({ id: "c0", week_of: "2026-11-02", created_at: "2026-11-02T09:00:00Z" })],
      names,
    });
    expect(out.map((s) => [s.name, s.status])).toEqual([
      ["Grace Mwangi", "needs_care"],
      ["Sipho Dlamini", "no_checkin"],
    ]);
    expect(out[0].walkingWithMe).toBe(true);
    expect(out[0].walkers.map((w) => w.name)).toEqual(["Daniel Pretorius", "Ruth Malan"]);
    expect(out[0].lastCheckin).toEqual({ weekOf: "2026-11-09", contact: "met", mood: "okay", daysAgo: 14 });
    expect(out[0].programName).toBe("FFX Sep 2026");
  });

  it("a taken care flag no longer counts as open", () => {
    const [s] = shapeStudents({
      me: "kim",
      today: "2026-11-23",
      enrolments: [{ id: "e-grace", user_id: "grace", program_id: "p1", status: "arrived", enrolled_at: null, programs: null }],
      walkers: [],
      checkins: [checkin({ week_of: "2026-11-23", needs_care: true, care_taken_by: "ruth", care_taken_at: "2026-11-23T13:00:00Z" })],
      names,
    });
    expect(s.status).toBe("on_track");
  });
});

describe("buildJourney", () => {
  it("is newest first and never carries note text", () => {
    const items = buildJourney({
      enrolledAt: "2026-07-01T08:00:00Z",
      arrivals: [{ status: "arrived", marked_at: "2026-09-07T10:00:00Z", course: "FFX" }],
      grades: [
        { letter_grade: "B+", graded_at: "2026-11-02T10:00:00Z", course: "BIB 101" },
        { letter_grade: null, graded_at: null, course: "INT 202" },
      ],
      checkins: [checkin({ needs_care: true, note_for_student: "PRIVATE-ISH TEXT" })],
      names,
    });
    expect(items.map((i) => i.title)).toEqual([
      "Check-in · okay",
      "Flagged · needs care",
      "Graded · BIB 101 · B+",
      "Arrived",
      "Enrolled",
    ]);
    expect(JSON.stringify(items)).not.toContain("PRIVATE-ISH TEXT");
    expect(items[0].detail).toBe("Met · Daniel");
  });
});

describe("parseCheckinBody", () => {
  it("accepts a full check-in and trims notes", () => {
    const r = parseCheckinBody({ enrollmentId: E1, contact: "met", mood: "good", noteForStudent: "  hi  ", noteStaffOnly: "", needsCare: true });
    expect(r).toEqual({
      ok: true,
      value: { enrollmentId: E1, contact: "met", mood: "good", noteForStudent: "hi", noteStaffOnly: null, needsCare: true },
    });
  });
  it("couldn't reach drops the mood", () => {
    const r = parseCheckinBody({ enrollmentId: E1, contact: "no_reach", mood: "great" });
    expect(r.ok && r.value.mood).toBeNull();
  });
  it("refuses a bad student, contact, mood or an over-long note", () => {
    expect(parseCheckinBody({ enrollmentId: "x", contact: "met", mood: "good" }).ok).toBe(false);
    expect(parseCheckinBody({ enrollmentId: E1, contact: "waved", mood: "good" }).ok).toBe(false);
    expect(parseCheckinBody({ enrollmentId: E1, contact: "met" }).ok).toBe(false);
    expect(parseCheckinBody({ enrollmentId: E1, contact: "met", mood: "good", noteStaffOnly: "x".repeat(2001) }).ok).toBe(false);
    expect(parseCheckinBody(null).ok).toBe(false);
  });
  it("needsCare is only ever true when sent as true", () => {
    const r = parseCheckinBody({ enrollmentId: E1, contact: "met", mood: "good", needsCare: "yes" });
    expect(r.ok && r.value.needsCare).toBe(false);
  });
});
