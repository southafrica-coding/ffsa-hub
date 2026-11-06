import { z } from "zod";

// Saveable course design, version 1.
// A design is a document (modules of pages, assignments, discussions), not a
// row per assignment. Turning assignments into submissions is a later slice.
// Canvas is the reference for this shape. Nothing here calls a model.

export const COURSE_DESIGN_VERSION = 1;

const title = z.string().trim().min(1).max(160);

export const courseDesignSchema = z.object({
  schema_version: z.literal(COURSE_DESIGN_VERSION),
  summary: z.string().trim().max(4000).optional(),
  modules: z
    .array(
      z.object({
        title,
        summary: z.string().trim().max(2000).optional(),
        items: z
          .array(
            z.discriminatedUnion("kind", [
              z.object({
                kind: z.literal("page"),
                title,
                body: z.string().max(50_000),
              }),
              z.object({
                kind: z.literal("assignment"),
                title,
                brief: z.string().max(20_000),
                points: z.number().int().min(0).max(1000),
                due_offset_days: z.number().int().min(0).max(365).optional(),
              }),
              z.object({
                kind: z.literal("discussion"),
                title,
                prompt: z.string().max(8000),
              }),
            ])
          )
          .max(40),
      })
    )
    .min(1)
    .max(40),
});

export type CourseDesign = z.infer<typeof courseDesignSchema>;

export function parseCourseDesign(
  input: unknown
): { ok: true; design: CourseDesign } | { ok: false; message: string } {
  const parsed = courseDesignSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "The course design is not a valid template." };
  }
  return { ok: true, design: parsed.data };
}

export function summarizeDesign(design: CourseDesign) {
  let pages = 0;
  let assignments = 0;
  let discussions = 0;
  let points = 0;
  for (const section of design.modules) {
    for (const item of section.items) {
      if (item.kind === "page") pages += 1;
      if (item.kind === "discussion") discussions += 1;
      if (item.kind === "assignment") {
        assignments += 1;
        points += item.points;
      }
    }
  }
  return { modules: design.modules.length, pages, assignments, discussions, points };
}
