// API contract for the Training tab's students and check-ins (T3). Pure:
// takes an ApiFetch, so tests pass a mock and the app passes the live one.
//
//   GET  /api/mobile/training/students                 the students I may see
//   GET  /api/mobile/training/students/[enrollmentId]  one student: journey + check-ins
//   POST /api/mobile/training/checkins                 save this week's check-in
//   POST /api/mobile/training/checkins/[id]/care       take an open "needs care"
//
// The server reads with the caller's own session (RLS, migration 334), so a
// staff-only note the person may not read never reaches the phone. Parsed
// tolerantly: one odd row doesn't hide the rest.

import { z } from "zod";

import { ApiError, type ApiFetch, type ApiFetchInit } from "@/lib/api";

import { strings } from "./strings";

type Init = Pick<ApiFetchInit, "signal">;

const nullableString = z.string().nullish().transform((v) => v || null);
export const CONTACTS = ["met", "called", "no_reach"] as const;
export const MOODS = ["hard", "okay", "good", "great"] as const;
export type Contact = (typeof CONTACTS)[number];
export type Mood = (typeof MOODS)[number];
export type StudentStatus = "needs_care" | "no_checkin" | "on_track" | "arriving";

const person = z.object({ userId: z.string(), name: z.string().catch("Unknown") });

export const studentSchema = z.object({
  enrollmentId: z.string(),
  name: z.string().catch("Unknown"),
  programId: z.string().catch(""),
  programName: z.string().catch(""),
  enrollmentStatus: z.string().catch(""),
  status: z.enum(["needs_care", "no_checkin", "on_track", "arriving"]).catch("on_track"),
  lastCheckin: z
    .object({
      weekOf: z.string(),
      contact: z.enum(CONTACTS).catch("met"),
      mood: z.enum(MOODS).nullish().transform((v) => v ?? null),
      daysAgo: z.number().catch(0),
    })
    .nullish()
    .transform((v) => v ?? null),
  walkers: z.array(person).catch([]),
  walkingWithMe: z.boolean().catch(false),
});
export type Student = z.infer<typeof studentSchema>;

function tolerant<T>(schema: z.ZodType<T>) {
  return z.array(z.unknown()).transform((rows) =>
    rows.flatMap((r) => {
      const p = schema.safeParse(r);
      return p.success ? [p.data] : [];
    }),
  );
}

export const studentListSchema = z.object({
  today: z.string().catch(""),
  students: tolerant(studentSchema),
});
export type StudentList = z.infer<typeof studentListSchema>;

export const checkinSchema = z.object({
  id: z.string(),
  weekOf: z.string(),
  contact: z.enum(CONTACTS).catch("met"),
  mood: z.enum(MOODS).nullish().transform((v) => v ?? null),
  noteForStudent: nullableString,
  noteStaffOnly: nullableString,
  needsCare: z.boolean().catch(false),
  careTaken: z
    .object({ by: z.string().catch("Someone"), at: z.string() })
    .nullish()
    .transform((v) => v ?? null),
  author: z.object({ id: z.string(), name: z.string().catch("Unknown") }),
  mine: z.boolean().catch(false),
});
export type Checkin = z.infer<typeof checkinSchema>;

export const journeyItemSchema = z.object({
  at: z.string(),
  kind: z.string().catch("other"),
  title: z.string(),
  detail: nullableString,
});
export type JourneyItem = z.infer<typeof journeyItemSchema>;

export const studentRecordSchema = z.object({
  today: z.string().catch(""),
  student: studentSchema,
  checkins: tolerant(checkinSchema),
  journey: tolerant(journeyItemSchema),
});
export type StudentRecord = z.infer<typeof studentRecordSchema>;

export type CheckinInput = {
  enrollmentId: string;
  contact: Contact;
  mood: Mood | null;
  noteForStudent: string;
  noteStaffOnly: string;
  needsCare: boolean;
};

export function getStudents(apiFetch: ApiFetch, init?: Init): Promise<StudentList> {
  return apiFetch("/api/mobile/training/students", { ...init, schema: studentListSchema });
}

export function getStudent(apiFetch: ApiFetch, enrollmentId: string, init?: Init): Promise<StudentRecord> {
  return apiFetch(`/api/mobile/training/students/${encodeURIComponent(enrollmentId)}`, { ...init, schema: studentRecordSchema });
}

export async function saveCheckin(apiFetch: ApiFetch, input: CheckinInput): Promise<void> {
  await apiFetch("/api/mobile/training/checkins", {
    method: "POST",
    body: { ...input, mood: input.contact === "no_reach" ? null : input.mood },
  });
}

export async function takeCare(apiFetch: ApiFetch, checkinId: string): Promise<void> {
  await apiFetch(`/api/mobile/training/checkins/${encodeURIComponent(checkinId)}/care`, { method: "POST" });
}

export function loadErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === "forbidden") return strings.common.forbidden;
    if (err.status === 404) return strings.common.notFound;
    if (err.status === 400 && err.message) return err.message;
    if (err.kind === "network" || err.kind === "timeout") return strings.common.network;
  }
  return strings.common.generic;
}
