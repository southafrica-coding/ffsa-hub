import type {
  DepartmentCluster,
  DepartmentHome,
  HubService,
  ServiceAudience,
  ServiceDepartmentRole,
} from "@/lib/departments/ui-contract";

export const STAFF_LANGUAGE = "FFSA staff with ministries under them";

export type DepartmentTab = "overview" | "people" | "okrs" | "rocks" | "services" | "budget";

const TAB_LABEL: Record<DepartmentTab, string> = {
  overview: "Overview",
  people: "People",
  okrs: "OKRs",
  rocks: "Rocks",
  budget: "Budget",
  services: "Services we run",
};

const CLUSTER_LABEL: Record<DepartmentCluster, string> = {
  leadership: "Leadership",
  inward: "Inward",
  outward: "Outward",
  backbone: "Backbone",
  alongside: "Alongside",
};

const AUDIENCE_LABEL: Record<ServiceAudience, string> = {
  all_signed_in: "Everyone signed in",
  point_leaders: "Point leaders",
  owners_only: "Departments that run it",
};

const ROLE_LABEL: Record<ServiceDepartmentRole, string> = {
  owner: "Owner",
  manager: "Manager",
  access: "Access",
  moderator: "Moderator",
};

export function tabLabel(key: DepartmentTab): string {
  return TAB_LABEL[key];
}

export function clusterLabel(cluster: DepartmentCluster | null): string {
  if (!cluster) return "—";
  return CLUSTER_LABEL[cluster];
}

export function audienceLabel(audience: ServiceAudience): string {
  return AUDIENCE_LABEL[audience];
}

export function serviceRoleLabel(role: ServiceDepartmentRole): string {
  return ROLE_LABEL[role];
}

export function departmentNames(
  departments: readonly { slug: string; name: string }[]
): Map<string, string> {
  return new Map(departments.map((department) => [department.slug, department.name]));
}

/** Managing departments, or the moderators when nobody owns or manages it. */
export function managingLabel(
  service: HubService,
  names: ReadonlyMap<string, string> = new Map()
): string {
  const departmentName = (slug: string) => names.get(slug) ?? slug;
  if (service.id === "evangelism") {
    const named = service.owners
      .filter((link) => link.role === "moderator")
      .map((link) => departmentName(link.slug))
      .join(", ");
    return `Moderated by ${named} and anyone with evangelism moderation`;
  }
  const managing = service.owners.filter((link) => link.role === "owner" || link.role === "manager");
  const shown = managing.length > 0 ? managing : service.owners.filter((link) => link.role === "moderator");
  const named = shown.map((link) => departmentName(link.slug)).join(", ");
  if (!named) return audienceLabel(service.audience);
  return managing.length > 0 ? named : `Moderators: ${named}`;
}

/** Tabs follow the access object on the payload. The API decides who can see what. */
export function visibleTabs(home: DepartmentHome): DepartmentTab[] {
  if (!home.access.canSeeDepartmentDetail) {
    return home.access.canSeeBudget ? ["budget"] : [];
  }
  const tabs: DepartmentTab[] = ["overview", "people", "okrs", "rocks"];
  if ((home.servicesRun?.length ?? 0) > 0) tabs.push("services");
  if (home.access.canSeeBudget) tabs.push("budget");
  return tabs;
}

export function tabHref(slug: string, key: DepartmentTab): string {
  return key === "overview" ? `/departments/${slug}` : `/departments/${slug}?tab=${key}`;
}

export function isDepartmentTab(value: string | undefined): value is DepartmentTab {
  return (
    value === "overview" ||
    value === "people" ||
    value === "okrs" ||
    value === "rocks" ||
    value === "budget" ||
    value === "services"
  );
}
