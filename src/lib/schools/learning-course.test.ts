import { describe, expect, it } from "vitest";
import {
  canBeCourseGrader,
  datesAreOrdered,
  enrollmentIsClosed,
  learningCourseDeleteBlock,
  lockedFieldChanges,
  parseLearningCourse,
  transcriptFieldChanges,
} from "./learning-course";

describe("parseLearningCourse", () => {
  it("uppercases the code and requires a name", () => {
    const parsed = parseLearningCourse({ code: "ffbx", name: "Bible school" }, "create");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toMatchObject({ code: "FFBX", name: "Bible school" });
  });

  it("rejects a code with spaces and an end date before the start", () => {
    expect(parseLearningCourse({ code: "FF BX", name: "Bible school" }, "create").ok).toBe(false);
    expect(datesAreOrdered({ start_date: "2026-03-01", end_date: "2026-02-01" })).toMatch(/end date/);
    expect(datesAreOrdered({ start_date: "2026-03-01", arrival_date: "2026-03-02" })).toMatch(/Arrival/);
  });
});

describe("learningCourseDeleteBlock", () => {
  const clear = { charges: 0, plans: 0, grades: 0, marks: 0 };
  it("keeps a course that finance, the transcript, or grader marks still use", () => {
    expect(learningCourseDeleteBlock({ ...clear, charges: 1 })).toMatch(/fee items/);
    expect(learningCourseDeleteBlock({ ...clear, plans: 2 })).toMatch(/billing plans/);
    expect(learningCourseDeleteBlock({ ...clear, grades: 1 })).toMatch(/transcript/);
    expect(learningCourseDeleteBlock({ ...clear, marks: 1 })).toMatch(/grader marks/);
    expect(learningCourseDeleteBlock(clear)).toBeNull();
  });
});

describe("course field locks", () => {
  it("locks code, dates, and graded once the course is in use, and logs transcript fields", () => {
    const existing = { code: "FFBX", name: "Bible", start_date: "2026-03-01", graded: true, credit_hours: 12 };
    expect(lockedFieldChanges(existing, { name: "Bible school" })).toEqual([]);
    expect(lockedFieldChanges(existing, { code: "FFX", graded: false })).toEqual(["code", "graded"]);
    expect(lockedFieldChanges(existing, { start_date: "2026-03-01T00:00:00.000Z" })).toEqual([]);
    expect(transcriptFieldChanges(existing, { name: "Bible school", credit_hours: 10 })).toEqual({
      name: { from: "Bible", to: "Bible school" },
      credit_hours: { from: 12, to: 10 },
    });
  });

  it("treats staff as graders and students as not", () => {
    expect(canBeCourseGrader(["student"])).toBe(false);
    expect(canBeCourseGrader([])).toBe(false);
    expect(canBeCourseGrader(["staff"])).toBe(true);
    expect(canBeCourseGrader(["staff", "student"])).toBe(true);
    expect(canBeCourseGrader(["admin"])).toBe(true);
    expect(enrollmentIsClosed({ removed_at: "2026-01-01", status: "arrived" })).toBe(true);
    expect(enrollmentIsClosed({ removed_at: null, status: "withdrawn" })).toBe(true);
    expect(enrollmentIsClosed({ removed_at: null, status: "arrived" })).toBe(false);
  });
});
