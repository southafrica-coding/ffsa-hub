// Data for the Me document screens.
//
// Reads of the person's OWN rows go straight to Supabase under RLS (users:
// own row; user_insurance_policies: own rows; staff_cv_entries: own rows;
// list_options: readable by everyone signed in). Everything with a side
// effect, and everything touching storage, goes through the website's
// /api/profile/* routes with the bearer token: the licence and passport
// files are only ever reached through a signed URL the server mints (the
// bucket is private, the phone never holds a storage path or a key).
//
// POPIA: nothing in this file logs, caches or reports what it reads.

import { z } from "zod";

import type { Option, PolicyRecord, InsuranceRow } from "./docs-logic";
import type { ProfileFetch } from "./http";
import { UPLOAD_TIMEOUT_MS } from "./http";

// The generated Database types predate several of these columns (migrations
// 151, 211, 218, 181), so the client is used loosely here, as in api.ts.
export type Db = { from: (table: string) => any };

const str = z.string().nullish().transform((v) => v ?? null);
const bool = z.boolean().nullish().transform((v) => v ?? false);

async function one<T>(query: PromiseLike<{ data: unknown; error: { message?: string } | null }>, schema: z.ZodType<T>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(error.message ?? "read failed");
  return schema.parse(data ?? {});
}

// ── Licence ────────────────────────────────────────────────────────────────

export const licenceSchema = z.object({
  licence: z.object({
    drivers_licence_number: str,
    licence_country: str,
    licence_code: str,
    licence_expiry_date: str,
    licence_file_name: str,
    has_file: bool,
    signed_url: str,
    base_driving_test_status: z.string().nullish().transform((v) => v ?? "not_required"),
    base_driving_test_passed_at: str,
  }),
});
export type Licence = z.infer<typeof licenceSchema>["licence"];

export const uploadSchema = z.object({ file_name: str, signed_url: str });

export async function getLicence(f: ProfileFetch, signal?: AbortSignal): Promise<Licence> {
  return (await f("/api/profile/licence", { schema: licenceSchema, signal })).licence;
}

export function saveLicence(f: ProfileFetch, d: { number: string; country: string; code: string; expiry: string }) {
  return f("/api/profile/licence", {
    method: "PUT",
    body: {
      drivers_licence_number: d.number.trim(),
      licence_country: d.country,
      licence_code: d.code.trim(),
      licence_expiry_date: d.expiry,
    },
  });
}

export type PhotoPart = { uri: string; name: string; type: "image/jpeg" };

function photoForm(p: PhotoPart): FormData {
  const form = new FormData();
  // React Native's FormData takes a { uri, name, type } file part.
  form.append("file", { uri: p.uri, name: p.name, type: p.type } as unknown as Blob);
  return form;
}

export type DocKind = "licence" | "passport-photo";

export function uploadDocPhoto(f: ProfileFetch, kind: DocKind, p: PhotoPart) {
  return f(`/api/profile/${kind}`, { method: "POST", body: photoForm(p), schema: uploadSchema, timeoutMs: UPLOAD_TIMEOUT_MS });
}

export function removeDocFile(f: ProfileFetch, kind: DocKind) {
  return f(`/api/profile/${kind}`, { method: "DELETE" });
}

// ── Passport photo ─────────────────────────────────────────────────────────

export const passportSchema = z.object({
  passport: z.object({ has_file: bool, file_name: str, uploaded_at: str, signed_url: str }),
});
export type Passport = z.infer<typeof passportSchema>["passport"];

export async function getPassport(f: ProfileFetch, signal?: AbortSignal): Promise<Passport> {
  return (await f("/api/profile/passport-photo", { schema: passportSchema, signal })).passport;
}

// ── Health insurance ───────────────────────────────────────────────────────

const insuranceRowSchema = z.object({
  health_insurance_provider: str,
  health_insurance_policy_number: str,
  health_insurance_expiry_date: str,
  health_insurance_no_expiry: bool,
  health_insurance_confirmed_at: str,
  next_health_insurance_provider: str,
  next_health_insurance_policy_number: str,
  next_health_insurance_expiry_date: str,
  next_health_insurance_no_expiry: bool,
});

const policyRowsSchema = z.array(
  z.object({
    id: z.string(),
    provider: z.string(),
    policy_number: str,
    expiry_date: str,
    no_expiry: bool,
    recorded_at: z.string(),
  }),
);

const optionRowsSchema = z.array(z.object({ value: z.string(), label: z.string() }));

export type InsuranceData = {
  current: InsuranceRow;
  next: Omit<InsuranceRow, "confirmedAt"> | null;
  history: PolicyRecord[];
  /** The admin-edited provider list ([] = use the built-in one). */
  providers: Option[];
};

export async function getInsurance(db: Db, userId: string): Promise<InsuranceData> {
  const [row, policies, providers] = await Promise.all([
    one(
      db
        .from("users")
        .select(
          "health_insurance_provider, health_insurance_policy_number, health_insurance_expiry_date, health_insurance_no_expiry, health_insurance_confirmed_at, next_health_insurance_provider, next_health_insurance_policy_number, next_health_insurance_expiry_date, next_health_insurance_no_expiry",
        )
        .eq("id", userId)
        .maybeSingle(),
      insuranceRowSchema,
    ),
    one(
      db
        .from("user_insurance_policies")
        .select("id, provider, policy_number, expiry_date, no_expiry, recorded_at")
        .eq("user_id", userId)
        .order("recorded_at", { ascending: false }),
      z.preprocess((v) => (Array.isArray(v) ? v : []), policyRowsSchema),
    ),
    // A missing or unreadable list is not an error: the built-in list applies.
    one(
      db
        .from("list_options")
        .select("value, label")
        .eq("list_key", "insurance_provider")
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      z.preprocess((v) => (Array.isArray(v) ? v : []), optionRowsSchema),
    ).catch(() => [] as Option[]),
  ]);
  return {
    current: {
      provider: row.health_insurance_provider,
      policyNumber: row.health_insurance_policy_number,
      expiryDate: row.health_insurance_expiry_date,
      noExpiry: row.health_insurance_no_expiry,
      confirmedAt: row.health_insurance_confirmed_at,
    },
    next: row.next_health_insurance_provider
      ? {
          provider: row.next_health_insurance_provider,
          policyNumber: row.next_health_insurance_policy_number,
          expiryDate: row.next_health_insurance_no_expiry ? null : row.next_health_insurance_expiry_date,
          noExpiry: row.next_health_insurance_no_expiry,
        }
      : null,
    history: policies.map((p) => ({
      id: p.id,
      provider: p.provider,
      policyNumber: p.policy_number,
      expiryDate: p.expiry_date,
      noExpiry: p.no_expiry,
      recordedAt: p.recorded_at,
    })),
    providers,
  };
}

/** The current policy goes through the same route the web's insurance section uses. */
export function saveCurrentPolicy(f: ProfileFetch, body: Record<string, unknown>) {
  return f("/api/profile/update", { method: "PUT", body });
}

export function confirmInsurance(f: ProfileFetch) {
  return f("/api/profile/insurance-confirm", { method: "POST" });
}

export function saveNextPolicy(f: ProfileFetch, body: Record<string, unknown>) {
  return f("/api/profile/insurance-next", { method: "PUT", body });
}

export function removeNextPolicy(f: ProfileFetch) {
  return f("/api/profile/insurance-next", { method: "DELETE" });
}

export function deletePolicyRecord(f: ProfileFetch, id: string) {
  return f(`/api/profile/insurance-policies/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ── Household ──────────────────────────────────────────────────────────────

export const memberSchema = z.object({
  id: z.string(),
  relationship: z.string(),
  full_name: z.string().nullish().transform((v) => v ?? ""),
  first_name: str,
  last_name: str,
  email: str,
  date_of_birth: str,
  gender: str,
  passport_country: str,
  passport_number: str,
  passport_expiry_date: str,
  is_international: bool,
  visa_category: str,
  visa_type: str,
  visa_expiry_date: str,
  health_insurance_provider: str,
  health_insurance_policy_number: str,
  health_insurance_expiry_date: str,
  health_insurance_no_expiry: bool,
});
export type Member = z.infer<typeof memberSchema>;

const membersSchema = z.object({ members: z.array(memberSchema).nullish().transform((v) => v ?? []) });

const selfRowSchema = z.object({
  marital_status: str,
  household_linked_at: str,
  is_international: bool,
  visa_category: str,
  visa_type: str,
  visa_expiry_date: str,
  health_insurance_provider: str,
  health_insurance_policy_number: str,
  health_insurance_expiry_date: str,
  health_insurance_no_expiry: bool,
});
export type HouseholdSelf = z.infer<typeof selfRowSchema>;

export type HouseholdData = { members: Member[]; self: HouseholdSelf; providers: Option[] };

export async function getHousehold(f: ProfileFetch, db: Db, userId: string, signal?: AbortSignal): Promise<HouseholdData> {
  const [list, self, providers] = await Promise.all([
    f("/api/profile/household", { schema: membersSchema, signal }),
    one(
      db
        .from("users")
        .select(
          "marital_status, household_linked_at, is_international, visa_category, visa_type, visa_expiry_date, health_insurance_provider, health_insurance_policy_number, health_insurance_expiry_date, health_insurance_no_expiry",
        )
        .eq("id", userId)
        .maybeSingle(),
      selfRowSchema,
    ),
    one(
      db
        .from("list_options")
        .select("value, label")
        .eq("list_key", "insurance_provider")
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      z.preprocess((v) => (Array.isArray(v) ? v : []), optionRowsSchema),
    ).catch(() => [] as Option[]),
  ]);
  return { members: list.members, self, providers };
}

const savedMemberSchema = z.object({ member: memberSchema });

export async function saveMember(f: ProfileFetch, id: string | null, body: Record<string, unknown>): Promise<Member> {
  const res = await f(id ? `/api/profile/household/${encodeURIComponent(id)}` : "/api/profile/household", {
    method: id ? "PUT" : "POST",
    body,
    schema: savedMemberSchema,
  });
  return res.member;
}

export function removeMember(f: ProfileFetch, id: string) {
  return f(`/api/profile/household/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function leaveHousehold(f: ProfileFetch) {
  return f("/api/profile/household/link", { method: "DELETE" });
}

// ── Staff CV ───────────────────────────────────────────────────────────────

const cvRowSchema = z.object({ essence_statement: str, job_description: str });

const cvEntriesSchema = z.array(
  z.object({
    id: z.string(),
    category: z.string(),
    title: z.string().nullish().transform((v) => v ?? ""),
    description: str,
    start_date: str,
    end_date: str,
    added_by_role: str,
  }),
);
export type CvEntry = z.infer<typeof cvEntriesSchema>[number];

export type CvData = { essence: string; jobDescription: string; entries: CvEntry[] };

export async function getCv(db: Db, userId: string): Promise<CvData> {
  const [row, entries] = await Promise.all([
    one(db.from("users").select("essence_statement, job_description").eq("id", userId).maybeSingle(), cvRowSchema),
    one(
      db
        .from("staff_cv_entries")
        .select("id, category, title, description, start_date, end_date, added_by_role")
        .eq("user_id", userId)
        .order("category", { ascending: true })
        .order("sort_order", { ascending: true }),
      z.preprocess((v) => (Array.isArray(v) ? v : []), cvEntriesSchema),
    ),
  ]);
  return { essence: row.essence_statement ?? "", jobDescription: row.job_description ?? "", entries };
}

export function saveEssence(f: ProfileFetch, essence: string) {
  return f("/api/profile/cv", { method: "PATCH", body: { essence_statement: essence.trim() } });
}
