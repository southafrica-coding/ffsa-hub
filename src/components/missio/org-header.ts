import { orgHref } from "./access";
import type { OrgSwitcherOrg } from "./use-org-switcher";

/** Seeded `organisations.name` for slug `ffsa` (migration 329). */
export const FFSA_ORG_NAME = "Fire & Fragrance South Africa";

export const BACK_TO_FFSA_HUB = "Back to FFSA Hub";

export type OrgHeaderState =
  | { kind: "switcher"; orgs: OrgSwitcherOrg[] }
  | { kind: "back" }
  | { kind: "static"; name: string };

/**
 * `/api/missio/me` lists `org_staff_roles` only. FFSA platform roles
 * (`super_admin`, `staff`, and the rest of `user_roles`) are not in that
 * list, and `org_staff_roles.role` cannot store them. A pastor who is also
 * FFSA staff therefore comes back with one org named "Missio". Any platform
 * role still counts as FFSA access, so the switcher offers both.
 *
 * An empty or missing org list is a real link home. A single Missio org
 * with a confirmed empty platform-role list stays a static label.
 */
export function missioOrgHeader(input: {
  orgs: Array<{ id: string; slug: string; name: string }> | null;
  /** Names from GET /api/me `roles`. Null when that read failed. */
  ffsaRoleNames: readonly string[] | null;
  /**
   * Platform roles only add FFSA when the viewer can open Missio.
   * A list that already has two orgs still switches, matching the
   * previous header.
   */
  allowPlatformFfsa?: boolean;
}): OrgHeaderState {
  if (input.orgs == null || input.orgs.length === 0) return { kind: "back" };

  const missio = input.orgs.find((org) => org.slug === "missio");
  const ffsa = input.orgs.find((org) => org.slug === "ffsa");
  const platformFfsa =
    input.allowPlatformFfsa !== false &&
    (input.ffsaRoleNames ?? []).some((name) => name.trim().length > 0);

  const options: OrgSwitcherOrg[] = input.orgs.map((org) => ({
    id: org.id,
    slug: org.slug,
    name: org.name,
    href: orgHref(org.slug),
  }));

  if (!ffsa && platformFfsa) {
    options.unshift({
      id: "ffsa",
      slug: "ffsa",
      name: FFSA_ORG_NAME,
      href: orgHref("ffsa"),
    });
  }

  if (options.length > 1) return { kind: "switcher", orgs: options };

  // One org, and we could not check platform roles. Don't leave a dead label.
  if (input.ffsaRoleNames == null && !ffsa) return { kind: "back" };

  return { kind: "static", name: missio?.name ?? input.orgs[0]?.name ?? "Missio" };
}

/** True when the Missio org list cannot see FFSA, so platform roles must be read. */
export function needsPlatformRoleLookup(orgs: Array<{ slug: string }> | null | undefined): boolean {
  if (!orgs || orgs.length === 0) return false;
  const hasMissio = orgs.some((org) => org.slug === "missio");
  const hasFfsa = orgs.some((org) => org.slug === "ffsa");
  return hasMissio && !hasFfsa;
}
