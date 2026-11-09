import type { CourseDesign } from "./course-design";

// How a per-course study agent plugs into the API without a new vendor.
//
// The hub already calls Anthropic from src/app/api/assistant/route.ts
// (read-only, the caller's own Supabase client, logged to ai_assistant_queries).
// There is no Mindjoy (or other tutor) client in the repo. A later slice
// should reuse that Anthropic client with the pack this function builds:
// school + course name, and only the student-visible design (pages,
// assignment briefs, discussion prompts). No grade notes. No other school's
// material. Tools stay inside the course: read_course_page, read_own_submission.
//
// POST .../agent returns 501 until that slice is switched on. It does not
// call a model.

export type CourseAgentPack = {
  provider: "anthropic";
  model_env: "AI_ASSISTANT_MODEL_FAST";
  tools: ["read_course_page", "read_own_submission"];
  system: string;
  material: Array<{
    module: string;
    kind: "page" | "assignment" | "discussion";
    title: string;
    text: string;
  }>;
};

export function buildCourseAgentContext(input: {
  schoolName: string;
  courseCode: string;
  courseName: string;
  design: CourseDesign | null;
}): CourseAgentPack {
  const material: CourseAgentPack["material"] = [];
  for (const section of input.design?.modules ?? []) {
    for (const item of section.items) {
      if (item.kind === "page") {
        material.push({ module: section.title, kind: "page", title: item.title, text: item.body });
      } else if (item.kind === "assignment") {
        material.push({ module: section.title, kind: "assignment", title: item.title, text: item.brief });
      } else {
        material.push({ module: section.title, kind: "discussion", title: item.title, text: item.prompt });
      }
    }
  }

  return {
    provider: "anthropic",
    model_env: "AI_ASSISTANT_MODEL_FAST",
    tools: ["read_course_page", "read_own_submission"],
    system: [
      `You are a study assistant for ${input.courseCode} ${input.courseName} at ${input.schoolName} (Fire & Fragrance South Africa).`,
      "Answer only from the course material you are given. If it is not in the material, say so.",
      "Do not grade the student. Do not invent school policy or scripture references.",
      "South African context: dates and English as this school writes them. Do not assume a US campus.",
    ].join(" "),
    material,
  };
}
