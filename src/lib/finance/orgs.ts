/**
 * The two finance organisations and their projects (migration 290).
 *
 *   npc   FFSA NPC     xero_region 'za'   records in ZAR
 *   usa   FF USA Inc   xero_region 'us'   records in USD (always)
 *
 * A "project" is an option of an org's Xero tracking category "Ministries",
 * stored per org (finance_projects). Projects are never merged across orgs;
 * the cross-org link (linked_project_id) is set by hand only.
 *
 * The org for a payment is chosen explicitly: the event's setting
 * (events.finance_org_id), overridable per payment (orders.finance_org_id).
 * Rand can go to either org, so nothing here routes by currency and there is
 * no default org. The database answers the same question with
 * finance_org_for_order().
 */

import { hasAnyRole } from "@/lib/api-auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type FinanceOrgKey = "npc" | "usa";
export type FinanceRecordCurrency = "ZAR" | "USD";

export const FINANCE_PROJECT_TYPES = ["ministry", "event", "asset"] as const;
export type FinanceProjectType = (typeof FINANCE_PROJECT_TYPES)[number];

export const FINANCE_PROJECT_TYPE_LABELS: Record<FinanceProjectType, string> = {
  ministry: "Ministry",
  event: "Event",
  asset: "Asset",
};

export type FinanceOrg = {
  id: string;
  key: FinanceOrgKey;
  name: string;
  xero_region: "za" | "us";
  record_currency: FinanceRecordCurrency;
  projects_category_name: string;
  is_active: boolean;
};

export type FinanceProject = {
  id: string;
  org_id: string;
  name: string;
  sort_order: number | null;
  project_type: FinanceProjectType | null;
  linked_project_id: string | null;
  notes: string | null;
  is_active: boolean;
  archived_at: string | null;
};

// ────────────────────────────────────────────────────────────
// Rules
// ────────────────────────────────────────────────────────────

/**
 * Which finance org a payment belongs to: the payment's own choice, else the
 * event's, else null.
 *
 * null means "finance org not chosen yet" — show it as such and ask. Never
 * fill it in from the currency (rand can go to either org) and never assume
 * a default org.
 */
export function resolveFinanceOrgId(input: {
  paymentOrgId?: string | null;
  eventOrgId?: string | null;
}): string | null {
  return input.paymentOrgId ?? input.eventOrgId ?? null;
}

/** The currency an org keeps its records in. FF USA Inc is always USD. */
export function recordCurrencyForOrg(
  org: FinanceOrgKey | { key: FinanceOrgKey }
): FinanceRecordCurrency {
  const key = typeof org === "string" ? org : org.key;
  return key === "usa" ? "USD" : "ZAR";
}

export function isFinanceProjectType(value: unknown): value is FinanceProjectType {
  return typeof value === "string" && (FINANCE_PROJECT_TYPES as readonly string[]).includes(value);
}

/**
 * Reads a Type value from a form or request body. null / "" mean "not set".
 * Anything else that isn't one of the three types is rejected.
 */
export function parseFinanceProjectType(
  value: unknown
): { ok: true; value: FinanceProjectType | null } | { ok: false } {
  if (value === null || value === "") return { ok: true, value: null };
  if (isFinanceProjectType(value)) return { ok: true, value };
  return { ok: false };
}

/**
 * Checks a cross-org link before it is saved. The database trigger enforces
 * the same rule; this gives a plain message instead of a Postgres error.
 */
export function linkProblem(
  project: { id: string; org_id: string },
  linked: { id: string; org_id: string } | null
): string | null {
  if (!linked) return "The project to link to was not found";
  if (linked.id === project.id) return "A project cannot be linked to itself";
  if (linked.org_id === project.org_id) {
    return "A project can only be linked to a project in the other organisation";
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// Access
// ────────────────────────────────────────────────────────────

/**
 * May change a project's type, notes and link. Mirrors the finance_projects
 * UPDATE policy: is_admin() (super_admin / admin), the finance_admin role, or
 * finance.edit (direct or through a role bundle, as has_permission counts it).
 */
export async function canEditFinanceProjects(supabase: Client, userId: string): Promise<boolean> {
  const [byRole, { data: byPermission }] = await Promise.all([
    hasAnyRole(supabase, userId, ["super_admin", "admin", "finance_admin"]),
    supabase.rpc("has_permission", { required_permission: "finance.edit" }),
  ]);
  return byRole || byPermission === true;
}

// ────────────────────────────────────────────────────────────
// Data
// ────────────────────────────────────────────────────────────

const PROJECT_COLUMNS =
  "id, org_id, name, sort_order, project_type, linked_project_id, notes, is_active, archived_at";

export async function listFinanceOrgs(supabase: Client) {
  return supabase
    .from("finance_orgs")
    .select("id, key, name, xero_region, record_currency, projects_category_name, is_active")
    .order("key");
}

/** Every project in both orgs, archived ones included, in Xero CSV order. */
export async function listFinanceProjects(supabase: Client) {
  return supabase
    .from("finance_projects")
    .select(PROJECT_COLUMNS)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("name");
}

export async function getFinanceProject(supabase: Client, id: string) {
  return supabase.from("finance_projects").select(PROJECT_COLUMNS).eq("id", id).maybeSingle();
}

/** Only the fields finance may edit. Name and org come from Xero. */
export type FinanceProjectPatch = {
  project_type?: FinanceProjectType | null;
  notes?: string | null;
  linked_project_id?: string | null;
};

export async function updateFinanceProject(
  supabase: Client,
  id: string,
  patch: FinanceProjectPatch,
  userId: string
) {
  return supabase
    .from("finance_projects")
    .update({ ...patch, updated_by: userId })
    .eq("id", id)
    .select(PROJECT_COLUMNS)
    .single();
}
