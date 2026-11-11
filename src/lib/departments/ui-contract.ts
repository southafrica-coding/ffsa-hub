/**
 * Response contract for the Departments & Services API.
 * Hub UI imports this file. Serializers live in shape.ts and
 * src/lib/services/present.ts.
 *
 * Slug is staff_ministries.slug. Money is integer cents. Currency is ZAR.
 *
 * OKR key-result status is one of complete, in_progress, moving_forward,
 * not_started, stuck. A missing database value becomes not_started.
 *
 * budget is links[] or null. Each link is
 * { projectId: string|null, name, budgetCents, spentCents, currency: 'ZAR' }.
 * budget is null when canSeeBudget is false.
 *
 * access flags: canSeeDepartmentDetail, canSeeBudget, canEditBudget,
 * canEditRocks, canSeePeopleEmails. budgetOnly is true for a finance-only
 * view (budget without detail). Those sections are null, and memberCount
 * is null because the roster is not read.
 *
 * viewerMembership is the viewer's own active membership in that
 * department: leader, member, or none. It is not visibility.
 * canSeeDepartmentDetail can be true while viewerMembership is none.
 *
 * Viewer memberships include isPointLeader. People include email, null
 * unless canSeePeopleEmails. purpose, cluster, dueOn and parentName are nullable.
 *
 * ServiceAudience is all_signed_in | point_leaders | owners_only.
 * HubService is the one service card type.
 */

export type DepartmentCluster = "leadership" | "inward" | "outward" | "backbone" | "alongside";

export type PersonCapacity = "leader" | "member";

/** Active staff_ministry_members row for the viewer in one department. */
export type ViewerDepartmentMembership = "member" | "leader" | "none";

export interface DepartmentPerson {
  name: string;
  capacity: PersonCapacity;
  role?: string;
  email: string | null;
}

export interface DepartmentAccess {
  canSeeDepartmentDetail: boolean;
  canSeeBudget: boolean;
  canEditBudget: boolean;
  canEditRocks: boolean;
  canSeePeopleEmails: boolean;
}

export interface DepartmentSummary {
  slug: string;
  name: string;
  cluster: DepartmentCluster | null;
  parentSlug: string | null;
  /** Name of the parent ministry, from the rows already loaded. Null when there is no parent. */
  parentName: string | null;
  purpose: string | null;
  /** Null in finance-only mode: the roster is not read. */
  memberCount: number | null;
  active: boolean;
  /** True when the viewer gets the header and budget only. */
  budgetOnly: boolean;
  /**
   * Viewer's own active membership in this department.
   * leader is member_role leader. member is any other active membership.
   * none means no active membership. Admin and Leadership Team visibility
   * do not count.
   */
  viewerMembership: ViewerDepartmentMembership;
  access: DepartmentAccess;
}

export type RockStatus = "on_track" | "off_track" | "done";

export interface Rock {
  id: string;
  departmentSlug: string;
  title: string;
  owner: string;
  status: RockStatus;
  dueOn: string | null;
  quarter: string;
}

export interface BudgetLink {
  projectId: string | null;
  name: string | null;
  budgetCents: number;
  spentCents: number;
  currency: "ZAR";
}

export interface DepartmentBudget {
  departmentSlug: string;
  links: BudgetLink[];
}

export type OkrStatus = "complete" | "in_progress" | "moving_forward" | "not_started" | "stuck";

export interface OkrKeyResult {
  id: string;
  label: string | null;
  description: string;
  status: OkrStatus;
}

export interface OkrObjective {
  title: string;
  keyResults: OkrKeyResult[];
}

export interface DepartmentOkrs {
  departmentSlug: string;
  cycleName: string | null;
  cycleSlug: string | null;
  href: string;
  objectives: OkrObjective[];
}

export type ServiceDepartmentRole = "owner" | "manager" | "access" | "moderator";
export type ServiceAudience = "all_signed_in" | "point_leaders" | "owners_only";
export type ServiceRunRole = "owner" | "manager" | "moderator";

export interface ServiceDepartmentLink {
  slug: string;
  role: ServiceDepartmentRole;
}

export interface DepartmentServiceRun {
  serviceId: string;
  role: ServiceRunRole;
}

export interface SubMinistry {
  slug: string;
  name: string;
  purpose: string | null;
  memberCount: number;
  people: DepartmentPerson[];
}

export interface HubService {
  id: string;
  name: string;
  summary: string;
  href: string;
  moduleId: string;
  owners: ServiceDepartmentLink[];
  audience: ServiceAudience;
}

export interface ViewerMembership {
  departmentSlug: string;
  capacity: PersonCapacity;
  isPointLeader: boolean;
}

export interface DepartmentHome {
  department: DepartmentSummary;
  access: DepartmentAccess;
  viewerMemberships: ViewerMembership[];
  people: DepartmentPerson[] | null;
  okrs: DepartmentOkrs | null;
  rocks: Rock[] | null;
  budget: DepartmentBudget | null;
  servicesRun: DepartmentServiceRun[] | null;
  subMinistries: SubMinistry[] | null;
}

export interface HomeDashboard {
  departments: DepartmentSummary[];
  services: HubService[];
  rocksDue: Rock[];
  okrCheckInsDue: [];
  viewerMemberships: ViewerMembership[];
}

export const OKR_STATUSES = ["complete", "in_progress", "moving_forward", "not_started", "stuck"] as const;

/** Map a key-result status. Missing or blank becomes not_started. */
export function okrStatus(value: string | null | undefined): OkrStatus {
  if (value == null || value.trim() === "") return "not_started";
  if ((OKR_STATUSES as readonly string[]).includes(value)) return value as OkrStatus;
  return "not_started";
}
