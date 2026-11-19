import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OrgAccess } from "@/lib/missio/access";
import type { MissioErrorCode } from "@/lib/missio/types";

/**
 * Missio roles a pastor can give from a person's profile (board M10c).
 * Pastor, admin and finance stay with the FFSA admins who grant them today.
 */
export const GRANTABLE_ROLES = ["coach", "house_church_leader"] as const;
export type GrantableRole = (typeof GRANTABLE_ROLES)[number];

export type HubAccess = {
  /** The person has a Hub login linked to their contact. */
  hasLogin: boolean;
  /** Missio roles on that login. Empty without a login. */
  roles: string[];
  /** When the login last signed in, if ever. */
  lastSignInAt: string | null;
};

type Fail = { ok: false; status: number; error: string; code: MissioErrorCode };

const fail = (status: number, code: MissioErrorCode, error: string): Fail => ({ ok: false, status, code, error });

const grantSchema = z.object({ role: z.enum(GRANTABLE_ROLES), on: z.boolean() }).strict();

type Client = ReturnType<typeof createAdminClient>;

function admin(): Client | null {
  try {
    return createAdminClient();
  } catch (error) {
    console.error("[missio] admin client unavailable", error instanceof Error ? error.message : "missing env");
    return null;
  }
}

async function contactFor(auth: OrgAccess, personId: string): Promise<{ contactId: string } | Fail> {
  const row = await auth.supabase
    .from("org_people")
    .select("contact_id")
    .eq("id", personId)
    .eq("org_id", auth.orgId)
    .maybeSingle();
  if (row.error) {
    console.error("[missio] person read failed", row.error.message);
    return fail(500, "server_error", "Something went wrong.");
  }
  const contactId = (row.data as { contact_id?: string } | null)?.contact_id;
  if (!contactId) return fail(404, "not_found", "Person not found.");
  return { contactId };
}

async function loginFor(db: Client, contactId: string) {
  const users = await db
    .from("users")
    .select("id, last_sign_in_at, is_active")
    .eq("contact_id", contactId)
    .order("last_sign_in_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (users.error) return { error: users.error.message };
  const user = ((users.data ?? []) as Array<{ id: string; last_sign_in_at: string | null; is_active: boolean | null }>)[0];
  return { user: user && user.is_active !== false ? user : null };
}

async function rolesFor(db: Client, userId: string, orgId: string) {
  const rows = await db.from("org_staff_roles").select("role").eq("user_id", userId).eq("org_id", orgId);
  if (rows.error) return { error: rows.error.message };
  return { roles: ((rows.data ?? []) as Array<{ role?: string }>).map((row) => row.role).filter((r): r is string => Boolean(r)) };
}

/** Pastors only: does this person have a Hub login, and which Missio roles? */
export async function getHubAccess(auth: OrgAccess, personId: string): Promise<{ ok: true; access: HubAccess } | Fail> {
  const person = await contactFor(auth, personId);
  if ("ok" in person) return person;
  const db = admin();
  if (!db) return fail(500, "server_error", "Something went wrong.");
  const login = await loginFor(db, person.contactId);
  if ("error" in login) {
    console.error("[missio] login lookup failed", login.error);
    return fail(500, "server_error", "Something went wrong.");
  }
  if (!login.user) return { ok: true, access: { hasLogin: false, roles: [], lastSignInAt: null } };
  const roles = await rolesFor(db, login.user.id, auth.orgId);
  if ("error" in roles) {
    console.error("[missio] role lookup failed", roles.error);
    return fail(500, "server_error", "Something went wrong.");
  }
  return { ok: true, access: { hasLogin: true, roles: roles.roles.sort(), lastSignInAt: login.user.last_sign_in_at } };
}

/**
 * Pastors only: give or take a coach / house church leader role. Grants are
 * service-role writes (there is no write policy on org_staff_roles). Audited.
 */
export async function setHubRole(
  auth: OrgAccess,
  personId: string,
  body: unknown
): Promise<{ ok: true; access: HubAccess } | Fail> {
  const parsed = grantSchema.safeParse(body);
  if (!parsed.success) return fail(400, "invalid_input", "Check the fields and try again.");
  const person = await contactFor(auth, personId);
  if ("ok" in person) return person;
  const db = admin();
  if (!db) return fail(500, "server_error", "Something went wrong.");
  const login = await loginFor(db, person.contactId);
  if ("error" in login) {
    console.error("[missio] login lookup failed", login.error);
    return fail(500, "server_error", "Something went wrong.");
  }
  if (!login.user) return fail(409, "no_login", "This person has no Hub login yet.");
  if (login.user.id === auth.user.id) return fail(409, "forbidden", "You can't change your own roles here.");

  const { role, on } = parsed.data;
  const write = on
    ? await db
        .from("org_staff_roles")
        .upsert({ user_id: login.user.id, org_id: auth.orgId, role, granted_by: auth.user.id }, { onConflict: "user_id,org_id,role", ignoreDuplicates: true })
    : await db.from("org_staff_roles").delete().eq("user_id", login.user.id).eq("org_id", auth.orgId).eq("role", role);
  if (write.error) {
    console.error("[missio] role write failed", write.error.message);
    return fail(500, "server_error", "Something went wrong.");
  }
  const logged = await db.from("audit_logs").insert({
    user_id: auth.user.id,
    action: on ? "missio.role_granted" : "missio.role_removed",
    resource_type: "org_staff_role",
    resource_id: login.user.id,
    changes: { role, personId },
    created_at: new Date().toISOString(),
  });
  if (logged.error) console.error("[missio] audit failed", logged.error.message);
  return getHubAccess(auth, personId);
}
