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
import { canHoldEventsKeyInAnyScope } from "@/lib/auth/event-access";

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
  /** The mirrored Xero option (migration 291). null = not linked to Xero yet. */
  xero_tracking_option_id?: string | null;
  /** The linked option's state in Xero, when listed with listFinanceProjects. */
  xero_option?: { status: string; missing_since: string | null } | null;
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

/**
 * May see what the Hub mirrors from Xero (accounts, tracking options,
 * projects, sync runs). Mirrors the read policies in migration 275:
 * is_admin(), finance_admin, finance.view, finance.edit or budget.view_all.
 * Everyone else sees none of the Xero lists.
 */
export async function canReadFinanceXero(supabase: Client, userId: string): Promise<boolean> {
  const [byRole, ...perms] = await Promise.all([
    hasAnyRole(supabase, userId, ["super_admin", "admin", "finance_admin"]),
    ...["finance.view", "finance.edit", "budget.view_all"].map((key) =>
      supabase.rpc("has_permission", { required_permission: key })
    ),
  ]);
  return byRole || perms.some((p: { data: unknown }) => p.data === true);
}

/** One org as the event form's select sees it: never accounts or projects. */
export type FinanceOrgChoice = Pick<FinanceOrg, "id" | "key" | "name" | "record_currency" | "is_active">;

/**
 * The two orgs for the "Finance organisation" select (finance_org_choices(),
 * migration 291). Open to event editors as well as finance; anyone else gets
 * an empty list from the database.
 */
export async function listFinanceOrgChoices(supabase: Client) {
  return supabase.rpc("finance_org_choices");
}

/**
 * The event form's "Finance organisation" select: shown to people who can
 * edit events (the same check PATCH /api/events/[id] makes), with just the
 * two org names. No finance permission needed; nothing else from finance or
 * Xero is read. Anyone else gets canPick false and no orgs.
 */
export async function getEventFinanceOrgPicker(
  supabase: Client,
  userId: string | null
): Promise<{ canPick: boolean; orgs: FinanceOrgChoice[] }> {
  // finance_org_choices() is unchanged by 314: events.create in any scope.
  if (!userId || !(await canHoldEventsKeyInAnyScope(supabase, userId, "events.create"))) {
    return { canPick: false, orgs: [] };
  }
  const { data, error } = await listFinanceOrgChoices(supabase);
  // Before migration 291 the function doesn't exist: no select, not an error page.
  if (error || !Array.isArray(data)) return { canPick: false, orgs: [] };
  return {
    canPick: data.length > 0,
    orgs: (data as FinanceOrgChoice[]).map(({ id, key, name, record_currency, is_active }) => ({
      id,
      key,
      name,
      record_currency,
      is_active,
    })),
  };
}

// ────────────────────────────────────────────────────────────
// Data
// ────────────────────────────────────────────────────────────

const PROJECT_COLUMNS =
  "id, org_id, name, sort_order, project_type, linked_project_id, notes, is_active, archived_at, xero_tracking_option_id";

export async function listFinanceOrgs(supabase: Client) {
  return supabase
    .from("finance_orgs")
    .select("id, key, name, xero_region, record_currency, projects_category_name, is_active")
    .order("key");
}

/**
 * Every project in both orgs, archived ones included, in list order, with the
 * linked Xero option's state (archived / missing in Xero).
 */
export async function listFinanceProjects(supabase: Client) {
  return supabase
    .from("finance_projects")
    .select(`${PROJECT_COLUMNS}, xero_option:xero_tracking_options(status, missing_since)`)
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
