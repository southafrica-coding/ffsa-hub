// Row shapes for the schools reads, parsed with zod so a missing or odd field
// degrades one row instead of breaking the screen. Embedded rows (programs,
// staff, events) can arrive as an object, a one-item array or null.

import { z } from "zod";

const str = z.string().nullish().transform((v) => v ?? null);
const num = z.number().nullish().transform((v) => v ?? 0);

/** PostgREST embeds: take the object (or the first array item), else null. */
function embed<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (Array.isArray(v) ? (v[0] ?? null) : v), schema.nullish().transform((x) => x ?? null));
}

export const staffSchema = z.object({
  first_name: str,
  last_name: str,
  preferred_name: str,
  email: str,
});
export type Staff = z.infer<typeof staffSchema>;

export const programmeSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: str,
  credit_hours: num,
});
export type Programme = z.infer<typeof programmeSchema>;

export const enrolmentSchema = z.object({
  id: z.string(),
  status: z.string(),
  enrolled_at: z.string(),
  completed_at: str,
  programs: embed(programmeSchema),
  assigned_staff: embed(staffSchema),
});
export type Enrolment = z.infer<typeof enrolmentSchema>;

export const applicationSchema = z.object({
  id: z.string(),
  program_id: z.string(),
  status: z.string(),
  submitted_at: str,
  programs: embed(programmeSchema.pick({ id: true, name: true, code: true })),
  assigned_staff: embed(staffSchema),
});
export type Application = z.infer<typeof applicationSchema>;

export const courseSchema = z.object({
  id: z.string(),
  code: str,
  name: z.string(),
  credit_hours: num,
  sequence: num,
  start_date: str,
  end_date: str,
  arrival_date: str,
});
export type Course = z.infer<typeof courseSchema>;

export const enrolmentDetailSchema = enrolmentSchema.extend({
  programs: embed(
    programmeSchema.extend({
      courses: z
        .array(z.unknown())
        .nullish()
        .transform((rows) => (rows ?? []).flatMap((r) => {
          const p = courseSchema.safeParse(r);
          return p.success ? [p.data] : [];
        })),
    }),
  ),
});
export type EnrolmentDetail = z.infer<typeof enrolmentDetailSchema>;

export const gradeSchema = z.object({ course_id: z.string(), letter_grade: str });
export type Grade = z.infer<typeof gradeSchema>;

export const attendanceSchema = z.object({
  id: z.string(),
  status: z.string(),
  checked_in_at: str,
  events: embed(z.object({ id: z.string(), title: z.string(), start_date: str, location: str })),
});
export type AttendanceRecord = z.infer<typeof attendanceSchema>;
