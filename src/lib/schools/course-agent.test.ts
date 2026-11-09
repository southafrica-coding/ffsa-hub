import { describe, expect, it } from "vitest";
import { buildCourseAgentContext } from "./course-agent";
import type { CourseDesign } from "./course-design";

const design: CourseDesign = {
  schema_version: 1,
  modules: [
    {
      title: "Week 1",
      items: [
        { kind: "page", title: "Welcome", body: "Read Luke 4." },
        { kind: "assignment", title: "Journal", brief: "One page.", points: 5 },
      ],
    },
  ],
};

describe("buildCourseAgentContext", () => {
  it("uses the existing Anthropic path and only this course's material", () => {
    const pack = buildCourseAgentContext({
      schoolName: "FFBX",
      courseCode: "FFBX",
      courseName: "Bible school",
      design,
    });
    expect(pack.provider).toBe("anthropic");
    expect(pack.tools).toEqual(["read_course_page", "read_own_submission"]);
    expect(pack.system).toContain("FFBX");
    expect(pack.system).toContain("Do not grade");
    expect(pack.material.map((item) => item.title)).toEqual(["Welcome", "Journal"]);
    expect(pack.system).not.toMatch(/Mindjoy/i);
  });
});
