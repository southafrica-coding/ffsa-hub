import {
  ADMIN_MODULES,
  SYSTEM_MODULES,
  getAccessibleModules,
} from "@/config/modules";
import type {
  DepartmentPageModel,
  DepartmentSummary,
  DepartmentTab,
  DepartmentTool,
  DepartmentViewer,
  HubService,
  ListedService,
} from "@/types/departments";
import {
  BUDGETS,
  CLUSTER_LABEL,
  CURRENT_QUARTER,
  EXCLUDED_DEPARTMENT_SLUGS,
  MINISTRY_HOMES,
  MOCK_VIEWER,
  OKR_CYCLE,
  ROCKS,
  SERVICES,
  type MinistryRecord,
} from "./mocks";

const EXCLUDED = new Set<string>(EXCLUDED_DEPARTMENT_SLUGS);

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
 * The one function to replace when the session can name the caller.
 * Pages must not import `MOCK_VIEWER` themselves.
 */
export function getDepartmentViewer(): DepartmentViewer {
  return MOCK_VIEWER;
}

export function clusterLabel(cluster: DepartmentSummary["cluster"]): string {
  return CLUSTER_LABEL[cluster];
}

export function currentQuarter(): string {
  return CURRENT_QUARTER;
}

function normalise(slug: string): string {
  return slug.trim().toLowerCase();
}

function homeByKey(slug: string): MinistryRecord | undefined {
  const key = normalise(slug);
  return MINISTRY_HOMES.find(
    (home) =>
      home.slug === key ||
      home.ministrySlug === key ||
      home.aliases.includes(key)
  );
}

/**
 * Allow-list. A home slug (or its ministry-slug alias) resolves.
 * Part-time ministries, RCA, No Ministry, Woven and the old portfolio
 * slugs resolve to null so the page can `notFound()`.
 */
export function resolveDepartment(slug: string): DepartmentSummary | null {
  const key = normalise(slug);
  if (!key || EXCLUDED.has(key)) return null;
  const home = homeByKey(key);
  if (!home) return null;
  return toSummary(home);
}

export function listDepartmentHomes(): DepartmentSummary[] {
  return MINISTRY_HOMES.map(toSummary);
}

function toSummary(home: MinistryRecord): DepartmentSummary {
  return {
    slug: home.slug,
    ministrySlug: home.ministrySlug,
    name: home.name,
    cluster: home.cluster,
    parentSlug: home.parentSlug,
    purpose: home.purpose,
    memberCount: home.memberCount,
    active: home.active,
  };
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

export function describeOwner(service: HubService): string {
  if (!service.ownerSlug) return "Owner to confirm";
  const owner = resolveDepartment(service.ownerSlug);
  const name = owner?.name ?? "Owner to confirm";
  return service.ownerAssumed ? `${name} (to confirm)` : name;
}

function toListed(service: HubService, viewer: DepartmentViewer): ListedService {
  return {
    ...service,
    ownerLabel: describeOwner(service),
    canOpen: viewerCanOpenModule(service.moduleId, viewer),
  };
}

function ownedServices(home: MinistryRecord, viewer: DepartmentViewer): ListedService[] {
  const ids = new Set(
    SERVICES.filter((service) => service.ownerSlug === home.slug).map((service) => service.id)
  );
  return SERVICES.filter((service) => ids.has(service.id)).map((service) =>
    toListed(service, viewer)
  );
}

function visibleTools(tools: DepartmentTool[], viewer: DepartmentViewer): DepartmentTool[] {
  return tools.filter((item) => viewerCanOpenModule(item.moduleId, viewer));
}

export function getDepartmentPage(
  slug: string,
  viewer: DepartmentViewer
): DepartmentPageModel | null {
  const key = normalise(slug);
  if (!key || EXCLUDED.has(key)) return null;
  const home = homeByKey(key);
  if (!home) return null;

  const services = ownedServices(home, viewer);
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
