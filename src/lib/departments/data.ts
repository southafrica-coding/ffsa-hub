import {
  ADMIN_MODULES,
  SYSTEM_MODULES,
  getAccessibleModules,
} from "@/config/modules";
import type {
  DepartmentHome,
  DepartmentPageModel,
  DepartmentServiceListing,
  DepartmentSummary,
  DepartmentTab,
  DepartmentTool,
  DepartmentViewer,
  HubService,
  ListedService,
  ServiceAudience,
  ServiceDepartmentRole,
  ServiceRunRole,
  SubMinistry,
} from "@/types/departments";
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
export function getDepartmentViewer(): DepartmentViewer {
  return {
    name: "",
    roles: [],
    permittedModules: [],
    memberships: [],
    usedServiceIds: [],
  };
}

export function clusterLabel(cluster: DepartmentSummary["cluster"]): string {
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
export function resolveDepartment(slug: string): DepartmentSummary | null {
  const key = exact(slug);
  if (!HOMES.has(key)) return null;
  const home = homeBySlug(key);
  return home ? toSummary(home) : null;
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

export function listDepartmentHomes(): DepartmentSummary[] {
  return MINISTRY_HOMES.map(toSummary);
}

function toSummary(home: MinistryRecord): DepartmentSummary {
  return {
    slug: home.slug,
    name: home.name,
    cluster: home.cluster,
    parentSlug: home.parentSlug,
    purpose: home.purpose,
    memberCount: home.memberCount,
    active: home.active,
  };
}

const AUDIENCE_LABEL: Record<ServiceAudience, string> = {
  all_signed_in: "Everyone signed in",
  ministry_leaders: "Ministry leaders",
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

export function viewerCanOpenModule(moduleId: string, viewer: DepartmentViewer): boolean {
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
  viewer: DepartmentViewer,
  evangelismRouteExists = true
): ListedService[] {
  return services
    .filter((service) => {
      if (service.moduleId === "evangelism" && !evangelismRouteExists) return false;
      return viewerCanOpenModule(service.moduleId, viewer);
    })
    .map((service) => toListed(service, viewer));
}

export function listServicesForViewer(viewer: DepartmentViewer): ListedService[] {
  return filterServices(SERVICES, viewer);
}

function toListed(service: HubService, viewer: DepartmentViewer): ListedService {
  return {
    ...service,
    managingLabel: managingLabel(service),
    canOpen: viewerCanOpenModule(service.moduleId, viewer),
  };
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

function servicesRunBy(departmentSlug: string, viewer: DepartmentViewer): DepartmentServiceListing[] {
  return servicesRunFor(departmentSlug).flatMap((row) => {
    const service = SERVICES.find((item) => item.id === row.serviceId);
    return service ? [{ ...toListed(service, viewer), role: row.role }] : [];
  });
}

function visibleTools(tools: DepartmentTool[], viewer: DepartmentViewer): DepartmentTool[] {
  return tools.filter((item) => viewerCanOpenModule(item.moduleId, viewer));
}

export function getDepartmentHome(slug: string): DepartmentHome | null {
  const home = homeBySlug(exact(slug));
  if (!home || !HOMES.has(home.slug)) return null;
  return {
    department: toSummary(home),
    people: home.people,
    okrs: {
      departmentSlug: home.slug,
      cycleName: OKR_CYCLE.name,
      cycleSlug: OKR_CYCLE.slug,
      href: OKR_CYCLE.href,
      objectives: home.objectives,
    },
    rocks: ROCKS.filter((rock) => rock.departmentSlug === home.slug),
    budget: BUDGETS.find((row) => row.departmentSlug === home.slug) ?? {
      departmentSlug: home.slug,
      project: null,
    },
    tools: home.tools,
    servicesRun: servicesRunFor(home.slug),
    subMinistries: subMinistriesOf(home.slug),
  };
}

export function getDepartmentPage(
  slug: string,
  viewer: DepartmentViewer
): DepartmentPageModel | null {
  const key = exact(slug);
  if (foldTarget(key) || !HOMES.has(key)) return null;
  const home = homeBySlug(key);
  if (!home) return null;

  const services = servicesRunBy(home.slug, viewer);
  const tabKeys: DepartmentTab[] = [
    "overview",
    "people",
    "okrs",
    "rocks",
    "budget",
    ...(services.length > 0 ? (["services"] as const) : []),
    "tools",
  ];

  const parent = home.parentSlug ? resolveDepartment(home.parentSlug) : null;

  return {
    department: toSummary(home),
    parent,
    people: home.people,
    leaders: home.people.filter((person) => person.capacity === "leader"),
    okrs: {
      departmentSlug: home.slug,
      cycleName: OKR_CYCLE.name,
      cycleSlug: OKR_CYCLE.slug,
      href: OKR_CYCLE.href,
      objectives: home.objectives,
    },
    rocks: ROCKS.filter((rock) => rock.departmentSlug === home.slug),
    budget: BUDGETS.find((row) => row.departmentSlug === home.slug) ?? {
      departmentSlug: home.slug,
      project: null,
    },
    tools: visibleTools(home.tools, viewer),
    services,
    subMinistries: subMinistriesOf(home.slug),
    tabs: tabKeys.map((key) => ({
      key,
      label: TAB_LABEL[key],
      href:
        key === "overview"
          ? `/departments/${home.slug}`
          : `/departments/${home.slug}?tab=${key}`,
    })),
    quarter: CURRENT_QUARTER,
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
