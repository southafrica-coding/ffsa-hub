import { gradeToPoints } from "@/services/schools";

// Several people can mark one student. The transcript still stores one
// official letter on `grades` (unique per enrolment + billing course,
// migration 006 / 179). Marks live in the proposed grade_marks table, one
// row per grader. Posting the official letter is a separate step.

export const LETTER_GRADES = [
  "A",
  "A-",
  "B+",
  "B",
  "B-",
  "C+",
  "C",
  "C-",
  "D+",
  "D",
  "D-",
  "F",
  "W",
  "I",
  "P",
] as const;

export type LetterGrade = (typeof LETTER_GRADES)[number];

const SCALE: Array<[LetterGrade, number]> = [
  ["A", 4],
  ["A-", 3.7],
  ["B+", 3.3],
  ["B", 3],
  ["B-", 2.7],
  ["C+", 2.3],
  ["C", 2],
  ["C-", 1.7],
  ["D+", 1.3],
  ["D", 1],
  ["D-", 0.7],
  ["F", 0],
];

export function isLetterGrade(value: unknown): value is LetterGrade {
  return typeof value === "string" && (LETTER_GRADES as readonly string[]).includes(value);
}

/** Closest letter on the transcript scale. A tie goes to the higher grade. */
export function nearestLetter(points: number): LetterGrade {
  let best: LetterGrade = "F";
  let bestDist = Infinity;
  for (const [letter, value] of SCALE) {
    const dist = Math.abs(value - points);
    if (dist < bestDist - 1e-9) {
      best = letter;
      bestDist = dist;
    }
  }
  return best;
}

export type CombineReason = "no_marks" | "waiting_on_graders" | "needs_a_person" | "ready";

/**
 * `slots` is one entry per assigned grader. Null means that grader has not
 * marked yet. W / I / P are not averaged — a person posts the official grade.
 */
export function combineLetterGrades(slots: Array<string | null>): {
  ready: boolean;
  letter: LetterGrade | null;
  reason: CombineReason;
} {
  if (slots.length === 0 || slots.every((slot) => !slot)) {
    return { ready: false, letter: null, reason: "no_marks" };
  }
  if (slots.some((slot) => !slot)) {
    return { ready: false, letter: null, reason: "waiting_on_graders" };
  }
  const letters = slots as string[];
  if (letters.some((letter) => letter === "W" || letter === "I" || letter === "P" || gradeToPoints(letter) === null)) {
    return { ready: false, letter: null, reason: "needs_a_person" };
  }
  const points = letters.map((letter) => gradeToPoints(letter) as number);
  const average = points.reduce((sum, value) => sum + value, 0) / points.length;
  return { ready: true, letter: nearestLetter(average), reason: "ready" };
}

export type GraderAssignment = {
  grader_user_id: string;
  billing_course_id: string | null;
  enrollment_id: string | null;
  can_post_official?: boolean;
};

/**
 * Flags the marks UI reads. School managers may post the official letter and
 * read every grader's notes. An assigned grader may post the official letter
 * only when a covering row says so, and never sees another grader's notes.
 * Letter visibility is unchanged.
 */
export function graderCapability(input: {
  manager: boolean;
  assignments: GraderAssignment[];
  enrollmentId: string;
  courseId: string;
}): { can_post_official: boolean; can_see_other_graders_notes: boolean } {
  const canPost =
    input.manager ||
    input.assignments.some(
      (row) =>
        row.can_post_official === true &&
        assignmentCovers(row, {
          enrollmentId: input.enrollmentId,
          courseId: input.courseId,
        })
    );
  return {
    can_post_official: canPost,
    can_see_other_graders_notes: input.manager,
  };
}

/** A row covers this student and course when its course/enrolment is null (wider) or equal. */
export function assignmentCovers(
  row: GraderAssignment,
  target: { enrollmentId: string; courseId: string }
): boolean {
  const courseOk = row.billing_course_id === null || row.billing_course_id === target.courseId;
  const studentOk = row.enrollment_id === null || row.enrollment_id === target.enrollmentId;
  return courseOk && studentOk;
}
