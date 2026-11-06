import { describe, expect, it } from "vitest";
import {
  cleanDesign,
  combineReasonCopy,
  designFromUnknown,
  designIssues,
  dueOn,
  emptyDesign,
  feeSetupHref,
  gradedCoursesForStudent,
  learningCourseIssues,
  summarizeDesign,
  type LearningCourseBody,
} from "./lms-api";

const shell = (patch: Partial<LearningCourseBody> = {}): LearningCourseBody => ({
  code: "FFX",
  name: "Fire and Fragrance Experience",
  description: null,
  notes: null,
  scope: "segment",
  sequence: 1,
  status: "upcoming",
  start_date: "2027-01-11",
  end_date: "2027-03-20",
  arrival_date: "2027-01-10",
  credit_hours: 3,
  graded: false,
  lead_staff_id: null,
  ...patch,
});

describe("course design", () => {
  it("starts from one empty module and counts what is inside", () => {
    const design = emptyDesign();
    design.modules[0].items = [
      { kind: "page", title: "Welcome", body: "Read this." },
      { kind: "assignment", title: "Journal", brief: "Write.", points: 10, due_offset_days: 7 },
      { kind: "discussion", title: "Response", prompt: "What stood out?" },
    ];
    expect(designIssues(design)).toBeNull();
    expect(summarizeDesign(cleanDesign(design))).toEqual({
      modules: 1,
      pages: 1,
      assignments: 1,
      discussions: 1,
      points: 10,
    });
  });

  it("rejects a design with no modules and a blank title", () => {
    expect(designIssues({ schema_version: 1, modules: [] })).toMatch(/1 and 40/);
    const design = emptyDesign();
    design.modules[0].title = " ";
    expect(designIssues(design)).toMatch(/title/);
  });

  it("drops a blank summary and an unset due date when cleaning", () => {
    const cleaned = cleanDesign({
      schema_version: 1,
      summary: "  ",
      modules: [
        {
          title: " Week 1 ",
          items: [{ kind: "assignment", title: " Essay ", brief: "Write.", points: 5 }],
        },
      ],
    });
    expect(cleaned.summary).toBeUndefined();
    expect(cleaned.modules[0].title).toBe("Week 1");
    expect(cleaned.modules[0].items[0]).toEqual({
      kind: "assignment",
      title: "Essay",
      brief: "Write.",
      points: 5,
    });
  });

  it("reads a saved design and ignores a broken one", () => {
    expect(designFromUnknown({ schema_version: 1, modules: [{ title: "A", items: [] }] })?.modules).toHaveLength(1);
    expect(designFromUnknown({ modules: [] })).toBeNull();
    expect(designFromUnknown(null)).toBeNull();
  });
});

describe("learning course shell", () => {
  it("accepts a dated segment and rejects an arrival after the start", () => {
    expect(learningCourseIssues(shell())).toBeNull();
    expect(learningCourseIssues(shell({ arrival_date: "2027-01-12" }))).toMatch(/Arrival/);
    expect(learningCourseIssues(shell({ end_date: "2027-01-01" }))).toMatch(/end date/);
    expect(learningCourseIssues(shell({ code: "X" }))).toMatch(/code/i);
    expect(learningCourseIssues(shell({ credit_hours: 41 }))).toMatch(/Credit hours/);
  });
});

describe("grader queue scope", () => {
  const courses = [
    { id: "1", code: "FFX", name: "FFX", sequence: 1, graded: false },
    { id: "2", code: "FFBX", name: "FFBX", sequence: 2, graded: true },
    { id: "3", code: "FFWX", name: "FFWX", sequence: 3, graded: true },
  ];

  it("keeps a whole-school student on every graded course", () => {
    expect(gradedCoursesForStudent(courses, [{ billing_course_id: null, code: null }], null).map((c) => c.code)).toEqual([
      "FFBX",
      "FFWX",
    ]);
  });

  it("limits a segment student to the courses on their track", () => {
    expect(
      gradedCoursesForStudent(courses, [{ billing_course_id: "3", code: "FFWX" }], null).map((c) => c.code)
    ).toEqual(["FFWX"]);
  });

  it("uses the pipeline track when the enrolment has no segments yet", () => {
    expect(
      gradedCoursesForStudent(courses, [], { kind: "segments", codes: ["FFBX"] }).map((c) => c.code)
    ).toEqual(["FFBX"]);
  });
});

describe("student-facing dates and copy", () => {
  it("counts the due date from the course start", () => {
    expect(dueOn("2027-01-11", 7)).toBe("18 Jan 2027");
    expect(dueOn(null, 7)).toBeNull();
  });

  it("says what a combined mark is waiting on", () => {
    expect(combineReasonCopy({ ready: false, letter: null, reason: "needs_a_person" })).toMatch(/not averaged/);
    expect(combineReasonCopy({ ready: true, letter: "B+", reason: "ready" })).toMatch(/B\+/);
  });

  it("keeps fee setup on the finance billing route", () => {
    expect(feeSetupHref("school", "course")).toBe("/finance/school-fees/school/billing/course");
    expect(feeSetupHref("school")).toBe("/finance/school-fees/school/billing");
  });
});
