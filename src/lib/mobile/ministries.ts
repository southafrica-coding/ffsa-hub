// ============================================================
// /api/mobile/ministries/** — access rule + response contract
// ============================================================
// The phone app's read-only mirror of the website's Ministry tab
// (src/app/(admin)/ministry/page.tsx and [id]/page.tsx). Those pages read
// rosters with the service-role client after their own access checks; the
// phone must never hold that key, so these endpoints run the SAME checks on
// the server and only then read with the admin client.
//
// The rule, exactly as the web pages apply it:
//   list   — admin or Leadership Team: every ministry; otherwise only the
//            ministries the caller actively leads; nobody else (the web
//            page redirects them to /dashboard).
//   detail — canView   = admin || leads this ministry || Leadership Team
//            canManage = admin || leads this ministry
//
// Payloads carry only what the web pages show: no profile columns beyond
// name and email, no pickable-user list, no staff search.
// ============================================================

import { z } from "zod";
import { callerIsAdmin, callerLeadsMinistry, getLedMinistryIds } from "@/lib/auth/check-ministry-access";
import { isLeadershipTeam } from "@/lib/auth/check-okr-access";
import { ministryTypeOf, type MinistryType } from "@/lib/ministries/ministry-type";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export const NO_STORE = { "Cache-Control": "no-store" };

// ── Access ─────────────────────────────────────────────────

export type MinistryListAccess = {
  isAdmin: boolean;
  /** Admin or Leadership Team: every ministry, not just led ones. */
  seesEverything: boolean;
  /** Ministries the caller leads (empty when seesEverything — not needed). */
  ledIds: string[];
};

/** Same order of checks as the web list page. */
export async function resolveListAccess(supabase: Client, userId: string): Promise<MinistryListAccess> {
  const isAdmin = await callerIsAdmin(supabase, userId);
  const isLeadership = !isAdmin && (await isLeadershipTeam(supabase, userId));
  const seesEverything = isAdmin || isLeadership;
  const ledIds = seesEverything ? [] : await getLedMinistryIds(supabase, userId);
  return { isAdmin, seesEverything, ledIds };
}

export function canSeeList(a: MinistryListAccess): boolean {
  return a.seesEverything || a.ledIds.length > 0;
}

export type MinistryDetailAccess = { isAdmin: boolean; canView: boolean; canManage: boolean };

/** Same checks as the web detail page. */
export async function resolveDetailAccess(
  supabase: Client,
  userId: string,
  ministryId: string
): Promise<MinistryDetailAccess> {
  const isAdmin = await callerIsAdmin(supabase, userId);
  const leadsThisMinistry = await callerLeadsMinistry(supabase, userId, ministryId);
  const canView = isAdmin || leadsThisMinistry || (await isLeadershipTeam(supabase, userId));
  return { isAdmin, canView, canManage: isAdmin || leadsThisMinistry };
}

/** Route ids are uuids; anything else is refused before any query. */
export const ministryIdSchema = z.string().uuid();

// ── Contract ───────────────────────────────────────────────

export type MobileMinistry = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  ministryType: MinistryType;
};

export type MobileMinistryListItem = MobileMinistry & { peopleCount: number };

export type MobileMinistryList = {
  /** "all" for admin / Leadership Team, "led" for a ministry leader. */
  scope: "all" | "led";
  /** Admins may create ministries (on the website). */
  canCreate: boolean;
  ministries: MobileMinistryListItem[];
};

export type MobileRosterMember = {
  membershipId: string;
  userId: string | null;
  name: string;
  email: string | null;
  role: "leader" | "member";
  status: string;
  isPointLeader: boolean;
  categoryIds: string[];
  pointLeaderCategoryIds: string[];
};

export type MobileMinistryDetail = {
  ministry: MobileMinistry;
  canManage: boolean;
  subcategories: { id: string; name: string }[];
  roster: MobileRosterMember[];
};

// ── Shaping (pure) ─────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

function ministryOf(m: any): MobileMinistry {
  return {
    id: String(m.id),
    name: String(m.name ?? ""),
    description: typeof m.description === "string" && m.description.trim() ? m.description : null,
    isActive: m.is_active !== false,
    ministryType: ministryTypeOf(m.ministry_type),
  };
}

/** The list rows the caller may see, in listMinistries order (by name). */
export function shapeList(rows: any[], access: MinistryListAccess): MobileMinistryList {
  const visible = rows.filter((m) => access.seesEverything || access.ledIds.includes(m.id));
  return {
    scope: access.seesEverything ? "all" : "led",
    canCreate: access.isAdmin,
    ministries: visible.map((m) => ({
      ...ministryOf(m),
      peopleCount: Number(m.staff_ministry_members?.[0]?.count ?? 0) || 0,
    })),
  };
}

/** Same as the web's nameOf: "First Last", else display name, else email. */
export function personName(u: any): string {
  return [u?.first_name, u?.last_name].filter(Boolean).join(" ") || u?.display_name || u?.email || "Unknown";
}

export function shapeDetail(
  ministry: any,
  roster: any[],
  subcategories: any[],
  canManage: boolean
): MobileMinistryDetail {
  return {
    ministry: ministryOf(ministry),
    canManage,
    subcategories: subcategories.map((c) => ({ id: String(c.id), name: String(c.name ?? "") })),
    roster: roster.map((r) => ({
      membershipId: String(r.id),
      userId: r.user?.id ?? null,
      name: personName(r.user),
      email: r.user?.email ?? null,
      role: r.member_role === "leader" ? "leader" : "member",
      status: typeof r.status === "string" ? r.status : "active",
      isPointLeader: r.is_point_leader === true,
      categoryIds: Array.isArray(r.category_ids) ? r.category_ids : [],
      pointLeaderCategoryIds: Array.isArray(r.point_leader_category_ids) ? r.point_leader_category_ids : [],
    })),
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
