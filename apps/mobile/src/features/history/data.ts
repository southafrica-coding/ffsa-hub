// Plain reads, straight from Supabase as the signed-in person: the same four
// queries the website's /my-history page runs with the user's own client
// (getUserHistory in src/services/records-library.ts), so row-level security
// decides exactly as it does on the web ("Users can read own library …",
// migration 061, kept by 212). Nothing here writes.
//
// Two deliberate differences from the web, both narrower:
//  - columns are listed instead of "*", so import bookkeeping (person_id,
//    import_id, content_hash) never reaches the phone;
//  - the web keeps going when one of the four reads fails (it shows what it
//    got); here a failure is an error state with a retry, so nobody mistakes
//    a missing section for "nothing on file".
//
// Every read filters on the caller's own user_id, as getUserHistory does, so
// Records Library admins (whose RLS shows every row) still see only their own.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import { supabase } from "@/lib/supabase";

import { strings } from "./strings";
import { applicationSchema, documentSchema, enrollmentSchema, paymentSchema, type History } from "./types";

export class DataError extends Error {
  name = "DataError";
}

type Db = Pick<SupabaseClient, "from">;
const db = () => supabase as unknown as Db;
type Res = { data: unknown; error: { message: string; code?: string } | null };

const SELECT = {
  applications: "id, program_name, cohort, status, submitted_at, raw_data",
  enrollments: "id, school_name, program_name, role, start_date, end_date, raw_data",
  payments: "id, amount, currency, description, paid_at, raw_data",
  documents: "id, doc_type, file_url, identifier, expires_at, raw_data",
} as const;

/** supabase-js reports a dropped connection as an error whose message says so. */
function failure(err: { message: string; code?: string }): DataError {
  // 42501: Postgres refused the read outright (not just "no rows").
  if (err.code === "42501") return new DataError(strings.common.forbidden);
  return new DataError(/network|fetch|timed? ?out|offline/i.test(err.message) ? strings.common.network : strings.common.generic);
}

export function loadErrorMessage(err: unknown): string {
  return err instanceof DataError ? err.message : strings.common.generic;
}

function rows<T>(schema: z.ZodType<T>, res: Res): T[] {
  if (res.error) throw failure(res.error);
  const out: T[] = [];
  // One odd row shouldn't hide the rest.
  for (const r of Array.isArray(res.data) ? res.data : []) {
    const p = schema.safeParse(r);
    if (p.success) out.push(p.data);
  }
  return out;
}

export async function loadHistory(userId: string, client: Db = db()): Promise<History> {
  // Newest first, undated last: the web's order.
  const read = (table: string, select: string, order: string) =>
    client.from(table).select(select).eq("user_id", userId).order(order, { ascending: false, nullsFirst: false });
  const [a, p, e, d] = (await Promise.all([
    read("library_applications", SELECT.applications, "submitted_at"),
    read("library_payments", SELECT.payments, "paid_at"),
    read("library_enrollments", SELECT.enrollments, "start_date"),
    read("library_documents", SELECT.documents, "expires_at"),
  ])) as Res[];
  return {
    applications: rows(applicationSchema, a),
    payments: rows(paymentSchema, p),
    enrollments: rows(enrollmentSchema, e),
    documents: rows(documentSchema, d),
  };
}
