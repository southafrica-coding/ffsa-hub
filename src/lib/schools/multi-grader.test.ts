import { describe, expect, it } from "vitest";
import { assignmentCovers, combineLetterGrades, nearestLetter } from "./multi-grader";

describe("combineLetterGrades", () => {
  it("waits until every assigned grader has marked", () => {
    expect(combineLetterGrades([null, null]).reason).toBe("no_marks");
    expect(combineLetterGrades(["A", null]).reason).toBe("waiting_on_graders");
    expect(combineLetterGrades(["W", "A"]).reason).toBe("needs_a_person");
  });

  it("averages quality points and rounds a tie up", () => {
    expect(combineLetterGrades(["A", "C"]).letter).toBe("B");
    // 3.5 sits halfway between A- and B+. The higher grade wins.
    expect(combineLetterGrades(["A", "B"]).letter).toBe("A-");
    expect(nearestLetter(3.85)).toBe("A");
    expect(combineLetterGrades(["A-", "B+"]).letter).toBe("A-");
  });
});

describe("assignmentCovers", () => {
  it("treats a null course or enrolment as the wider scope", () => {
    const target = { enrollmentId: "e1", courseId: "c1" };
    expect(assignmentCovers({ grader_user_id: "g", billing_course_id: null, enrollment_id: "e1" }, target)).toBe(true);
    expect(assignmentCovers({ grader_user_id: "g", billing_course_id: "c1", enrollment_id: null }, target)).toBe(true);
    expect(assignmentCovers({ grader_user_id: "g", billing_course_id: "c2", enrollment_id: null }, target)).toBe(false);
  });
});
