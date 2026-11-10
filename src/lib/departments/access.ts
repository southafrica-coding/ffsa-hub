import type { DepartmentAccess, PersonCapacity } from "@/types/departments";

/**
 * Input for access rules. Richer than the API's ViewerMembership, which has
 * no isLeader, active flag, admin bit, or finance permissions.
 */
export interface AccessMembership {
  slug: string;
  active: boolean;
  isLeader: boolean;
  isPointLeader: boolean;
  capacity: PersonCapacity;
}

export interface AccessViewer {
  name: string;
  isAdmin: boolean;
  roles: string[];
  permittedModules: string[];
  permissions: string[];
  memberships: AccessMembership[];
  usedServiceIds: string[];
}

const LEADERSHIP = "leadership_team";
const FINANCES = "finances_legal";

function activeMembership(viewer: AccessViewer, slug: string) {
  return viewer.memberships.find((membership) => membership.slug === slug && membership.active);
}

/** Active leader or point leader of this ministry. Inactive rows do not count. */
export function leadsMinistry(viewer: AccessViewer, slug: string): boolean {
  const membership = activeMembership(viewer, slug);
  return Boolean(membership && (membership.isLeader || membership.isPointLeader));
}

function hasFinanceRead(viewer: AccessViewer): boolean {
  if (activeMembership(viewer, FINANCES)) return true;
  const keys = new Set([...viewer.permissions, ...viewer.roles]);
  return keys.has("finance_admin") || keys.has("finance.view") || keys.has("finance.edit");
}

/**
 * Provisional access for one department. Backend can return this same object.
 * A viewer with neither detail nor budget cannot open the page.
 */
export function getDepartmentAccess(viewer: AccessViewer, slug: string): DepartmentAccess {
  const canSeeDepartmentDetail =
    viewer.isAdmin ||
    Boolean(activeMembership(viewer, slug)) ||
    Boolean(activeMembership(viewer, LEADERSHIP));
  const canSeeBudget = leadsMinistry(viewer, slug) || viewer.isAdmin || hasFinanceRead(viewer);
  const canEdit = leadsMinistry(viewer, slug) || viewer.isAdmin;
  return {
    canSeeDepartmentDetail,
    canSeeBudget,
    canEditBudget: canEdit,
    canEditRocks: canEdit,
    canSeePeopleEmails: canEdit,
  };
}

export function canOpenDepartment(access: DepartmentAccess): boolean {
  return access.canSeeDepartmentDetail || access.canSeeBudget;
}
