import { describe, expect, it } from "vitest";
import { parseCourseDesign, summarizeDesign } from "./course-design";

const design = {
  schema_version: 1,
  summary: "A quarter of Bible school",
  modules: [
    {
      title: "Week 1",
      items: [
        { kind: "page", title: "Welcome", body: "Read this first." },
        { kind: "assignment", title: "Journal", brief: "Write a page.", points: 10, due_offset_days: 7 },
        { kind: "discussion", title: "What stood out", prompt: "One verse." },
      ],
    },
  ],
};

describe("course design documents", () => {
  it("accepts a Canvas-shaped template and counts the work", () => {
    const parsed = parseCourseDesign(design);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(summarizeDesign(parsed.design)).toEqual({
      modules: 1,
      pages: 1,
      assignments: 1,
      discussions: 1,
      points: 10,
    });
  });

  it("rejects an empty course and an unknown item", () => {
    expect(parseCourseDesign({ schema_version: 1, modules: [] }).ok).toBe(false);
    expect(
      parseCourseDesign({
        schema_version: 1,
        modules: [{ title: "Week 1", items: [{ kind: "quiz", title: "Test" }] }],
      }).ok
    ).toBe(false);
  });
});
