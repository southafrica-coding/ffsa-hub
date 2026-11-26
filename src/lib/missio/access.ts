import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import type { MissioOrgRole } from "@/lib/missio/types";

// Hard wall: an FFSA admin or super_admin is not a pass. has_org_role runs
// first and counts only org_staff_roles. org_people INSERT is service-role
// only, after that check and a verified email or phone. Directory reads use
// org_people_directory on the user client — not a contacts join, which would
// expose notes, date of birth, and addresses. PATCH uses the user client and
// may change only campus, status, joined_at, and current_stage.
// org_staff_roles.campus is informational in Phase 0 and is not enforced.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const KNOWN_ORG_SLUGS = new Set(["ffsa", "missio"]);

/** Phase 0 people, search, and create/update routes. Pastors only. */
export const MISSIO_PEOPLE_ROLES = ["pastor"] as const;

/** Roles that open house churches. Lives in ./house-roles so the client shell shares it. */
export { MISSIO_HOUSE_ROLES } from "./house-roles";

export const MISSIO_SLUG = "missio";

export type OrgAccess = {
  user: { id: string };
  orgId: string;
  roles: string[];
  supabase: Client;
};

/**
 * First path segment, when it is a seeded org slug.
 * `/missio/people` → `missio`. `/api/missio` stays null — the `api` segment is not an org.
 */
export function getOrgSlugFromPath(pathname: string): "ffsa" | "missio" | null {
  const path = (pathname.split("?")[0] ?? "").split("#")[0] ?? "";
  const slug = path.split("/").filter(Boolean)[0];
  if (slug && KNOWN_ORG_SLUGS.has(slug)) return slug as "ffsa" | "missio";
  return null;
}

function notAuthenticated() {
  return NextResponse.json({ error: "Not authenticated", code: "unauthenticated" }, { status: 401 });
}

function notAuthorized() {
  return NextResponse.json({ error: "Not authorized", code: "forbidden" }, { status: 403 });
}

function lookupFailed() {
  return NextResponse.json({ error: "Something went wrong.", code: "server_error" }, { status: 500 });
}

/**
 * Signed-in caller who holds `roles` in `slug` (or any org role when `roles` is omitted).
 * The check is the has_org_role RPC on the user client. FFSA admin and
 * super_admin do not count. An RPC error is a refusal.
 */
export async function requireOrgRole(
  slug: string,
  roles?: readonly string[]
): Promise<OrgAccess | { response: NextResponse }> {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return { response: notAuthenticated() };

  const db = supabase as Client;
  const { data, error } = await db.rpc("has_org_role", {
    p_org_slug: slug,
    p_roles: roles ? [...roles] : null,
  });
  if (error) {
    console.error("[missio] has_org_role failed", error.message ?? "rpc error");
    return { response: lookupFailed() };
  }
  if (data !== true) return { response: notAuthorized() };

  const org = await db.from("organisations").select("id").eq("slug", slug).maybeSingle();
  if (org.error) {
    console.error("[missio] organisation lookup failed", org.error.message ?? slug);
    return { response: lookupFailed() };
  }
  if (!org.data?.id) return { response: notAuthorized() };

  const roleRows = await db
    .from("org_staff_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("org_id", org.data.id);
  if (roleRows.error) {
    console.error("[missio] org role lookup failed", roleRows.error.message);
    return { response: lookupFailed() };
  }

  const held = [
    ...new Set(
      ((roleRows.data ?? []) as Array<{ role?: string }>)
        .map((row) => row.role)
        .filter((role): role is string => typeof role === "string" && role.length > 0)
    ),
  ];
  return { user: { id: user.id }, orgId: org.data.id as string, roles: held, supabase: db };
}

type OrgEmbed = { id?: string; slug?: string; name?: string };

function oneOrg(value: OrgEmbed | OrgEmbed[] | null | undefined): OrgEmbed | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * The caller's own org_staff_roles, joined to organisations.
 * Reads through the user client so RLS keeps it to their rows.
 */
export async function getMyOrgs(
  supabase: Client,
  userId: string
): Promise<
  | { orgs: { id: string; slug: string; name: string }[]; rolesByOrg: Record<string, MissioOrgRole[]> }
  | { error: { message: string } }
> {
  const { data, error } = await supabase
    .from("org_staff_roles")
    .select("role, organisations(id, slug, name)")
    .eq("user_id", userId);
  if (error) return { error: { message: error.message ?? "membership lookup failed" } };

  const orgs: { id: string; slug: string; name: string }[] = [];
  const rolesByOrg: Record<string, MissioOrgRole[]> = {};
  const seen = new Set<string>();

  for (const row of (data ?? []) as Array<{ role?: string; organisations?: OrgEmbed | OrgEmbed[] | null }>) {
    const org = oneOrg(row.organisations);
    if (!org?.id || !org.slug || !org.name || !row.role) continue;
    if (!seen.has(org.id)) {
      seen.add(org.id);
      orgs.push({ id: org.id, slug: org.slug, name: org.name });
    }
    const list = rolesByOrg[org.slug] ?? [];
    if (!list.includes(row.role as MissioOrgRole)) list.push(row.role as MissioOrgRole);
    rolesByOrg[org.slug] = list;
  }

  return { orgs, rolesByOrg };
}
