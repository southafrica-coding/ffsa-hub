import type { DepartmentAccess, DepartmentViewer } from "@/types/departments";

const LEADERSHIP = "leadership_team";
const FINANCES = "finances_legal";

function activeMembership(viewer: DepartmentViewer, slug: string) {
  return viewer.memberships.find((membership) => membership.slug === slug && membership.active);
}

/** Active leader or point leader of this ministry. Inactive rows do not count. */
export function leadsMinistry(viewer: DepartmentViewer, slug: string): boolean {
  const membership = activeMembership(viewer, slug);
  return Boolean(membership && (membership.isLeader || membership.isPointLeader));
}

function hasFinanceRead(viewer: DepartmentViewer): boolean {
  if (activeMembership(viewer, FINANCES)) return true;
  const keys = new Set([...viewer.permissions, ...viewer.roles]);
  return keys.has("finance_admin") || keys.has("finance.view") || keys.has("finance.edit");
}

/**
 * Provisional access for one department. Backend can return this same object.
 * A viewer with neither detail nor budget cannot open the page.
 */
export function getDepartmentAccess(viewer: DepartmentViewer, slug: string): DepartmentAccess {
  const canSeeDepartmentDetail =
    viewer.isAdmin ||
    Boolean(activeMembership(viewer, slug)) ||
    Boolean(activeMembership(viewer, LEADERSHIP));
  const canSeeBudget = leadsMinistry(viewer, slug) || viewer.isAdmin || hasFinanceRead(viewer);
  const canEdit = leadsMinistry(viewer, slug) || viewer.isAdmin;
  return {
    canSeeDepartmentDetail,
    canSeeBudget,
    canEditRocks: canEdit,
    canEditBudget: canEdit,
    canSeePeopleEmails: canEdit,
  };
}

export function canOpenDepartment(access: DepartmentAccess): boolean {
  return access.canSeeDepartmentDetail || access.canSeeBudget;
}
