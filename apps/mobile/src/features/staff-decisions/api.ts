// API contract for Staff decisions. Pure: takes an ApiFetch, so tests pass a
// mock and the app passes the live one from @/lib/api-client.
//
//   GET  /api/mobile/staff-decisions               schools + counts (new)
//   GET  /api/mobile/staff-decisions/[programId]   one school's rows (new)
//   POST /api/schools/staff-decisions              record yes / no (existing,
//                                                  the website's own)
//   POST /api/schools/staff-decisions/make-staff   switch role to Staff
//                                                  (existing, the website's own)
//
// All four check Leadership Team on the server. Reads are parsed tolerantly
// (unknown fields ignored, optional ones may be missing) so the server can
// grow without breaking installed apps.

import { z } from "zod";

import { ApiError, type ApiFetch, type ApiFetchInit } from "@/lib/api";

import { strings } from "./strings";

type Init = Pick<ApiFetchInit, "signal">;

const nullableString = z.string().nullish().transform((v) => v || null);
const count = z.number().int().nonnegative().catch(0);

export const schoolSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string().catch(""),
  archived: z.boolean().catch(false),
  total: count,
  yes: count,
  no: count,
  undecided: count,
});

export const decisionSchema = z.object({
  accepted: z.boolean(),
  note: nullableString,
  decidedAt: z.string(),
  decidedByName: nullableString,
});

export const rowSchema = z.object({
  enrollmentId: z.string(),
  userId: nullableString,
  name: z.string().catch("Unknown"),
  email: nullableString,
  status: z.string().catch(""),
  isStaff: z.boolean().catch(false),
  department: nullableString,
  decision: decisionSchema.nullish().catch(null).transform((v) => v ?? null),
});

// One odd row shouldn't hide the rest.
function tolerantList<T extends z.ZodTypeAny>(item: T) {
  return z.array(z.unknown()).transform((rows) =>
    rows.flatMap((r) => {
      const p = item.safeParse(r);
      return p.success ? [p.data as z.infer<T>] : [];
    }),
  );
}

export const schoolListSchema = z.object({ schools: tolerantList(schoolSchema) });

export const schoolDetailSchema = z.object({
  school: schoolSchema,
  rows: tolerantList(rowSchema),
  departmentOptions: z
    .array(z.object({ value: z.string(), label: z.string() }))
    .nullish()
    .catch(null)
    .transform((v) => v ?? []),
});

export type School = z.infer<typeof schoolSchema>;
export type StaffDecisionRow = z.infer<typeof rowSchema>;
export type SchoolList = z.infer<typeof schoolListSchema>;
export type SchoolDetail = z.infer<typeof schoolDetailSchema>;
export type DepartmentOption = SchoolDetail["departmentOptions"][number];

export function getSchools(apiFetch: ApiFetch, init?: Init) {
  return apiFetch("/api/mobile/staff-decisions", { ...init, schema: schoolListSchema });
}

export function getSchool(apiFetch: ApiFetch, programId: string, init?: Init) {
  return apiFetch(`/api/mobile/staff-decisions/${encodeURIComponent(programId)}`, { ...init, schema: schoolDetailSchema });
}

/** Record or change a decision through the website's own endpoint. */
export async function recordDecision(
  apiFetch: ApiFetch,
  input: { enrollmentId: string; accepted: boolean; note: string },
): Promise<void> {
  await apiFetch("/api/schools/staff-decisions", {
    method: "POST",
    body: { enrollment_id: input.enrollmentId, accepted: input.accepted, note: input.note.trim() },
  });
}

/** After a yes: switch their membership role to Staff, optionally with a department. */
export async function makeStaff(apiFetch: ApiFetch, input: { enrollmentId: string; department: string | null }): Promise<void> {
  await apiFetch("/api/schools/staff-decisions/make-staff", {
    method: "POST",
    body: { enrollment_id: input.enrollmentId, department: input.department ?? "" },
  });
}

/** What to say when a load fails: forbidden and not-found get their own words. */
export function loadErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === "forbidden") return strings.common.forbidden;
    if (err.status === 404 || err.status === 400) return strings.common.notFound;
    if (err.kind === "network" || err.kind === "timeout") return strings.common.network;
  }
  return strings.common.generic;
}

/**
 * What to say when saving fails. The server's 400s are rules the sheet
 * can't see coming (the student was removed, the yes was changed meanwhile),
 * so they get their own "refresh" sentence.
 */
export function actionErrorMessage(err: unknown, action: "decide" | "makeStaff"): string {
  const sh = strings.sheet;
  if (err instanceof ApiError) {
    if (err.kind === "forbidden") return sh.forbidden;
    if (err.status === 400 || err.status === 404) return action === "decide" ? sh.saveRejected : sh.makeStaffRejected;
  }
  return action === "decide" ? sh.saveFailed : sh.makeStaffFailed;
}
