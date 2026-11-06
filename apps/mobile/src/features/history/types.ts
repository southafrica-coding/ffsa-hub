// Row shapes for the four Records Library tables the website's /my-history
// page reads (getUserHistory in src/services/records-library.ts), parsed with
// zod so a missing or odd field degrades one row instead of breaking the screen.

import { z } from "zod";

const str = z.string().nullish().transform((v) => v ?? null);

/** numeric(12,2) usually arrives as a number, but PostgREST may send a string. */
const amount = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  });

/** The raw import payload (a JSON object); anything else reads as empty. */
const raw = z
  .unknown()
  .transform((v) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}));

export const applicationSchema = z.object({
  id: z.string(),
  program_name: str,
  cohort: str,
  status: str,
  submitted_at: str,
  raw_data: raw,
});
export type ApplicationRecord = z.infer<typeof applicationSchema>;

export const enrollmentSchema = z.object({
  id: z.string(),
  school_name: str,
  program_name: str,
  role: str,
  start_date: str,
  end_date: str,
  raw_data: raw,
});
export type EnrollmentRecord = z.infer<typeof enrollmentSchema>;

export const paymentSchema = z.object({
  id: z.string(),
  amount,
  currency: str,
  description: str,
  paid_at: str,
  raw_data: raw,
});
export type PaymentRecord = z.infer<typeof paymentSchema>;

export const documentSchema = z.object({
  id: z.string(),
  doc_type: str,
  file_url: str,
  identifier: str,
  expires_at: str,
  raw_data: raw,
});
export type DocumentRecord = z.infer<typeof documentSchema>;

/** What getUserHistory returns, minus its error list (data.ts throws instead). */
export type History = {
  applications: ApplicationRecord[];
  enrollments: EnrollmentRecord[];
  payments: PaymentRecord[];
  documents: DocumentRecord[];
};
