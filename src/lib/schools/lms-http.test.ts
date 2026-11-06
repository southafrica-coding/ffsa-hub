import { describe, expect, it } from "vitest";
import { uniqueConflictMessage } from "./lms-http";

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
