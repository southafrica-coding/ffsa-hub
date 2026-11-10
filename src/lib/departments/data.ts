import {
  ADMIN_MODULES,
  SYSTEM_MODULES,
  getAccessibleModules,
} from "@/config/modules";
import {
  canOpenDepartment,
  getDepartmentAccess,
  type AccessViewer,
} from "@/app/(admin)/departments/_lib/viewer";
import type {
  DepartmentHome,
  DepartmentSummary,
  HubService,
  ServiceAudience,
  ServiceDepartmentRole,
  ServiceRunRole,
  SubMinistry,
  ViewerMembership,
} from "@/lib/departments/ui-contract";
import { DEPARTMENT_HOME_SLUGS, FOLDED_INTO, NON_HOME_SLUGS } from "./allow-list";
import {
  BUDGETS,
  CLUSTER_LABEL,
  CURRENT_QUARTER,
  FOLDED_MINISTRIES,
  MINISTRY_HOMES,
  OKR_CYCLE,
  ROCKS,
  SERVICES,
  type MinistryRecord,
} from "./mocks";

const HOMES = new Set<string>(DEPARTMENT_HOME_SLUGS);
const NON_HOMES = new Set<string>(NON_HOME_SLUGS);
const RUN_ROLES = new Set<ServiceDepartmentRole>(["owner", "manager", "moderator"]);

export type DepartmentTab =
  | "overview"
  | "people"
  | "okrs"
  | "rocks"
  | "services"
  | "budget"
  | "tools";

export function tabLabel(key: DepartmentTab): string {
  return TAB_LABEL[key];
}

const TAB_LABEL: Record<DepartmentTab, string> = {
  overview: "Overview",
  people: "People",
  okrs: "OKRs",
  rocks: "Rocks",
  budget: "Budget",
  services: "Services we run",
  tools: "Tools",
};

/**
 * Fail closed until the session is wired to `GET /api/me/home`.
 * No departments and no permissions. Tests build their own viewers.
 */
export function getDepartmentViewer(): AccessViewer {
  return {
    name: "",
    isAdmin: false,
    roles: [],
    permittedModules: [],
    permissions: [],
    memberships: [],
    usedServiceIds: [],
  };
}

export function toViewerMemberships(viewer: AccessViewer): ViewerMembership[] {
  return viewer.memberships
    .filter((membership) => membership.active)
    .map((membership) => ({
      departmentSlug: membership.slug,
      capacity: membership.isLeader ? "leader" : "member",
      isPointLeader: membership.isPointLeader,
    }));
}

export function clusterLabel(cluster: DepartmentSummary["cluster"]): string {
  if (!cluster) return "—";
  return CLUSTER_LABEL[cluster];
}

export function currentQuarter(): string {
  return CURRENT_QUARTER;
}

function exact(slug: string): string {
  return slug.trim();
}

function homeBySlug(slug: string): MinistryRecord | undefined {
  return MINISTRY_HOMES.find((home) => home.slug === slug);
}

/**
 * A home slug resolves. Anything else is null, including hyphenated
 * spellings and ministries that are folded or inactive.
 * Folds are not resolved here — call `foldTarget` first.
 */
export function resolveDepartment(
  slug: string,
  viewer: AccessViewer = getDepartmentViewer()
): DepartmentSummary | null {
  const key = exact(slug);
  if (!HOMES.has(key)) return null;
  const home = homeBySlug(key);
  return home ? toSummary(home, viewer) : null;
}

/**
 * Redirect target for an explicit fold. Not a generic parent lookup:
 * `education` stays a home, and `rooted_christian_academy` stays a 404.
 * A stored `parentSlug` (from `parent_id`) wins over `FOLDED_INTO`.
 */
export function foldTarget(
  slug: string,
  folded: readonly { slug: string; parentSlug: string | null }[] = FOLDED_MINISTRIES
): string | null {
  const key = exact(slug);
  if (!Object.prototype.hasOwnProperty.call(FOLDED_INTO, key)) return null;
  const row = folded.find((ministry) => ministry.slug === key);
  if (row?.parentSlug) return row.parentSlug;
  return FOLDED_INTO[key as keyof typeof FOLDED_INTO];
}

export function subMinistriesOf(parentSlug: string): SubMinistry[] {
  return FOLDED_MINISTRIES.filter((ministry) => foldTarget(ministry.slug) === parentSlug).map(
    (ministry) => ({
      slug: ministry.slug,
      name: ministry.name,
      purpose: ministry.purpose,
      memberCount: ministry.memberCount,
      people: ministry.people,
    })
  );
}

export function isNonHomeSlug(slug: string): boolean {
  return NON_HOMES.has(exact(slug));
}

export function listDepartmentHomes(viewer: AccessViewer = getDepartmentViewer()): DepartmentSummary[] {
  return MINISTRY_HOMES.map((home) => toSummary(home, viewer));
}

/**
 * Homes this viewer can open.
 * An active member sees the homes they belong to. Leadership Team and an
 * unscoped admin see every home. A finance reader can open every home, and
 * the ones without detail are already marked `budgetOnly` on the summary.
 * An empty list is a 404 on `/departments`.
 */
export function listDepartmentsForViewer(viewer: AccessViewer): DepartmentSummary[] {
  return listDepartmentHomes(viewer).filter(
    (home) => home.active && canOpenDepartment(home.access)
  );
}

function toSummary(home: MinistryRecord, viewer: AccessViewer): DepartmentSummary {
  const access = getDepartmentAccess(viewer, home.slug);
  return {
    slug: home.slug,
    name: home.name,
    cluster: home.cluster,
    parentSlug: home.parentSlug,
    purpose: home.purpose,
    memberCount: access.canSeeDepartmentDetail ? home.memberCount : null,
    active: home.active,
    budgetOnly: access.canSeeBudget && !access.canSeeDepartmentDetail,
    access,
  };
}

const AUDIENCE_LABEL: Record<ServiceAudience, string> = {
  all_signed_in: "Everyone signed in",
  point_leaders: "Point leaders",
  owners_only: "Departments that run it",
};

export function audienceLabel(audience: ServiceAudience): string {
  return AUDIENCE_LABEL[audience];
}

const ROLE_LABEL: Record<ServiceDepartmentRole, string> = {
  owner: "Owner",
  manager: "Manager",
  access: "Access",
  moderator: "Moderator",
};

export function serviceRoleLabel(role: ServiceDepartmentRole): string {
  return ROLE_LABEL[role];
}

function departmentName(slug: string): string {
  return (
    homeBySlug(slug)?.name ??
    FOLDED_MINISTRIES.find((ministry) => ministry.slug === slug)?.name ??
    slug
  );
}

/** Managing departments, or the moderators when nobody owns or manages it. */
export function managingLabel(service: HubService): string {
  if (service.id === "evangelism") {
    const names = service.owners
      .filter((link) => link.role === "moderator")
      .map((link) => departmentName(link.slug))
      .join(", ");
    return `Moderated by ${names} and anyone with evangelism moderation`;
  }
  const managing = service.owners.filter(
    (link) => link.role === "owner" || link.role === "manager"
  );
  const shown =
    managing.length > 0
      ? managing
      : service.owners.filter((link) => link.role === "moderator");
  const names = shown.map((link) => departmentName(link.slug)).join(", ");
  if (!names) return audienceLabel(service.audience);
  return managing.length > 0 ? names : `Moderators: ${names}`;
}

export function viewerCanOpenModule(moduleId: string, viewer: AccessViewer): boolean {
  const mod = [...ADMIN_MODULES, ...SYSTEM_MODULES].find((item) => item.id === moduleId);
  if (!mod) return false;
  const permitted = new Set(viewer.permittedModules);
  return getAccessibleModules([mod], viewer.roles, permitted).length === 1;
}

/**
 * `evangelismRouteExists` is true while `src/app/(admin)/evangelism/page.tsx`
 * is on this branch. Pass false to hide the card even for an admin.
 * `HIDDEN_FROM_NAV` is already applied inside `getAccessibleModules`.
 */
export function filterServices(
  services: HubService[],
  viewer: AccessViewer,
  evangelismRouteExists = true
): HubService[] {
  return services.filter((service) => {
    if (service.moduleId === "evangelism" && !evangelismRouteExists) return false;
    return viewerCanOpenModule(service.moduleId, viewer);
  });
}

export function listServicesForViewer(viewer: AccessViewer): HubService[] {
  return filterServices(SERVICES, viewer);
}

function runRole(service: HubService, departmentSlug: string): ServiceRunRole | null {
  const link = service.owners.find(
    (item) => item.slug === departmentSlug && RUN_ROLES.has(item.role)
  );
  return link ? (link.role as ServiceRunRole) : null;
}

function servicesRunFor(departmentSlug: string): { serviceId: string; role: ServiceRunRole }[] {
  return SERVICES.flatMap((service) => {
    const role = runRole(service, departmentSlug);
    return role ? [{ serviceId: service.id, role }] : [];
  });
}

export function visibleTabs(home: DepartmentHome): DepartmentTab[] {
  if (!home.access.canSeeDepartmentDetail) {
    return home.access.canSeeBudget ? ["budget"] : [];
  }
  const tabs: DepartmentTab[] = ["overview", "people", "okrs", "rocks"];
  if ((home.servicesRun?.length ?? 0) > 0) tabs.push("services");
  if (home.access.canSeeBudget) tabs.push("budget");
  tabs.push("tools");
  return tabs;
}

export function getDepartmentHome(slug: string, viewer: AccessViewer = getDepartmentViewer()): DepartmentHome | null {
  return getDepartmentPage(slug, viewer);
}

function budgetFor(slug: string) {
  return (
    BUDGETS.find((row) => row.departmentSlug === slug) ?? {
      departmentSlug: slug,
      links: [],
    }
  );
}

export function tabHref(slug: string, key: DepartmentTab): string {
  return key === "overview" ? `/departments/${slug}` : `/departments/${slug}?tab=${key}`;
}

export function getDepartmentPage(slug: string, viewer: AccessViewer): DepartmentHome | null {
  const key = exact(slug);
  if (foldTarget(key) || !HOMES.has(key)) return null;
  const home = homeBySlug(key);
  if (!home) return null;

  const access = getDepartmentAccess(viewer, home.slug);
  if (!canOpenDepartment(access)) return null;

  const detail = access.canSeeDepartmentDetail;
  const summary = toSummary(home, viewer);

  return {
    department: { ...summary, access, budgetOnly: access.canSeeBudget && !detail },
    access,
    viewerMemberships: toViewerMemberships(viewer),
    people: detail ? home.people : null,
    okrs: detail
      ? {
          departmentSlug: home.slug,
          cycleName: OKR_CYCLE.name,
          cycleSlug: OKR_CYCLE.slug,
          href: OKR_CYCLE.href,
          objectives: home.objectives,
        }
      : null,
    rocks: detail ? ROCKS.filter((rock) => rock.departmentSlug === home.slug) : null,
    budget: access.canSeeBudget ? budgetFor(home.slug) : null,
    servicesRun: detail ? servicesRunFor(home.slug) : null,
    subMinistries: detail ? subMinistriesOf(home.slug) : null,
  };
}

export function isDepartmentTab(value: string | undefined): value is DepartmentTab {
  return (
    value === "overview" ||
    value === "people" ||
    value === "okrs" ||
    value === "rocks" ||
    value === "budget" ||
    value === "services" ||
    value === "tools"
  );
}
