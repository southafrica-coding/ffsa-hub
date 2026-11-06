import { describe, expect, it } from "vitest";
import { gradeMarksRestrictMessage, uniqueConflictMessage } from "./lms-http";

describe("uniqueConflictMessage", () => {
  it("names the live course-code constraint and stays generic otherwise", () => {
    expect(
      uniqueConflictMessage({ message: 'duplicate key value violates unique constraint "billing_courses_program_id_code_key"' })
    ).toMatch(/course code/);
    expect(
      uniqueConflictMessage({ message: 'duplicate key value violates unique constraint "grades_enrollment_id_course_id_key"' })
    ).toMatch(/official grade/);
    expect(uniqueConflictMessage({ message: 'duplicate key value violates unique constraint "course_graders_scope"' })).toMatch(
      /already assigned/
    );
    expect(uniqueConflictMessage({ message: 'duplicate key value violates unique constraint "something_else"' })).toBe(
      "That record already exists."
    );
  });
});

describe("gradeMarksRestrictMessage", () => {
  it("turns a grade_marks restrict into a conflict sentence, and leaves other foreign keys alone", () => {
    expect(
      gradeMarksRestrictMessage({
        code: "23503",
        message: 'update or delete on table "billing_courses" violates foreign key constraint "grade_marks_billing_course_id_fkey" on table "grade_marks"',
      })
    ).toMatch(/course has grader marks/);
    expect(
      gradeMarksRestrictMessage({
        code: "23503",
        message: 'violates foreign key constraint "grade_marks_enrollment_id_fkey" on table "grade_marks"',
      })
    ).toMatch(/enrolment still has grader marks/);
    expect(
      gradeMarksRestrictMessage({
        code: "23503",
        message: 'violates foreign key constraint "grade_marks_grader_user_id_fkey" on table "grade_marks"',
      })
    ).toBe("This person still has grader marks.");
    expect(
      gradeMarksRestrictMessage({
        code: "23503",
        message: 'violates foreign key constraint "enrollments_user_id_fkey"',
      })
    ).toBeNull();
  });
});
