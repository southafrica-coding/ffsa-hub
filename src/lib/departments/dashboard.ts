import type { AccessViewer } from "@/app/(admin)/departments/_lib/viewer";
import type {
  DepartmentSummary,
  HomeDashboard,
  HubService,
  Rock,
} from "@/lib/departments/ui-contract";
import { filterServices, listDepartmentHomes, resolveDepartment } from "./data";
import { ROCKS, SERVICES } from "./mocks";

/** Calendar date in Africa/Johannesburg, `YYYY-MM-DD`. */
export function saTodayIso(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

/** Add days to a `YYYY-MM-DD` calendar date. No timezone shift. */
export function addIsoDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mySlugs(viewer: AccessViewer): Set<string> {
  const slugs = new Set<string>();
  for (const membership of viewer.memberships) {
    if (!membership.active) continue;
    const home = resolveDepartment(membership.slug);
    if (home) slugs.add(home.slug);
  }
  return slugs;
}

/** Homes the viewer leads or serves on. Excluded ministries never appear. */
export function selectMyDepartments(
  viewer: AccessViewer,
  homes: DepartmentSummary[] = listDepartmentHomes(viewer)
): DepartmentSummary[] {
  const slugs = mySlugs(viewer);
  return homes.filter((home) => home.active && slugs.has(home.slug));
}

/**
 * Services the viewer opens, among those their access can open.
 * An empty used-list stays empty — access alone is not usage.
 */
export function selectServicesIUse(
  viewer: AccessViewer,
  services: HubService[] = SERVICES
): HubService[] {
  const used = new Set(viewer.usedServiceIds);
  return filterServices(services, viewer).filter((service) => used.has(service.id));
}

/** Open rocks in the viewer's departments, overdue or due within `withinDays`. */
export function selectRocksDue(
  rocks: Rock[],
  departmentSlugs: Set<string>,
  today: string,
  withinDays = 14
): Rock[] {
  const horizon = addIsoDays(today, withinDays);
  return rocks
    .flatMap((rock) => {
      if (
        !departmentSlugs.has(rock.departmentSlug) ||
        rock.status === "done" ||
        rock.dueOn == null ||
        rock.dueOn > horizon
      ) {
        return [];
      }
      return [{ ...rock, dueOn: rock.dueOn }];
    })
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.title.localeCompare(b.title));
}

/** Mock home payload. Replace this body with `GET /api/me/home`. */
export function selectHomeDashboard(
  viewer: AccessViewer,
  today = saTodayIso()
): HomeDashboard {
  const departments = selectMyDepartments(viewer);
  const slugs = new Set(departments.map((department) => department.slug));
  return {
    departments,
    services: selectServicesIUse(viewer),
    rocksDue: selectRocksDue(ROCKS, slugs, today),
    // The API contract types this as an empty tuple. Check-in rows are not on the payload.
    okrCheckInsDue: [],
    viewerMemberships: viewer.memberships
      .filter((membership) => membership.active)
      .map((membership) => ({
        departmentSlug: membership.slug,
        capacity: membership.isLeader ? "leader" : "member",
        isPointLeader: membership.isPointLeader,
      })),
  };
}
