import type { DepartmentAccess, PersonCapacity } from "@/lib/departments/ui-contract";

/**
 * Mock viewer until GET /api/me/home is wired.
 * Not src/lib/departments/access.ts — Hub Backend #561 owns that path.
 *
 * Budget, rock edit and email follow member_role = leader, plus admin.
 * Finance readers also get canSeeBudget. isPointLeader does not.
 * Point leaders only gate Contacts (audience point_leaders).
 */
export interface AccessMembership {
  slug: string;
  active: boolean;
  /** member_role = 'leader'. A point leader alone is not a leader. */
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

/** Active member_role = leader. Inactive rows do not count. */
function isMinistryLeader(viewer: AccessViewer, slug: string): boolean {
  const membership = activeMembership(viewer, slug);
  return Boolean(membership?.isLeader);
}

function hasFinanceRead(viewer: AccessViewer): boolean {
  if (activeMembership(viewer, FINANCES)) return true;
  const keys = new Set([...viewer.permissions, ...viewer.roles]);
  return keys.has("finance_admin") || keys.has("finance.view") || keys.has("finance.edit");
}

/**
 * Flags for one department. A viewer with neither detail nor budget cannot open the page.
 */
export function getDepartmentAccess(viewer: AccessViewer, slug: string): DepartmentAccess {
  const canSeeDepartmentDetail =
    viewer.isAdmin ||
    Boolean(activeMembership(viewer, slug)) ||
    Boolean(activeMembership(viewer, LEADERSHIP));
  const canEdit = isMinistryLeader(viewer, slug) || viewer.isAdmin;
  return {
    canSeeDepartmentDetail,
    canSeeBudget: isMinistryLeader(viewer, slug) || viewer.isAdmin || hasFinanceRead(viewer),
    canEditBudget: canEdit,
    canEditRocks: canEdit,
    canSeePeopleEmails: canEdit,
  };
}

export function canOpenDepartment(access: DepartmentAccess): boolean {
  return access.canSeeDepartmentDetail || access.canSeeBudget;
}
