import { describe, expect, it } from "vitest";
import { datesAreOrdered, learningCourseDeleteBlock, parseLearningCourse } from "./learning-course";

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
  it("keeps a course that finance or the transcript still uses", () => {
    expect(learningCourseDeleteBlock({ charges: 1, plans: 0, grades: 0 })).toMatch(/fee items/);
    expect(learningCourseDeleteBlock({ charges: 0, plans: 2, grades: 0 })).toMatch(/billing plans/);
    expect(learningCourseDeleteBlock({ charges: 0, plans: 0, grades: 1 })).toMatch(/transcript/);
    expect(learningCourseDeleteBlock({ charges: 0, plans: 0, grades: 0 })).toBeNull();
  });
});
