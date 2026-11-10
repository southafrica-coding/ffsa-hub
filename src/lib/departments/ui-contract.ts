/**
 * Provisional API shapes for Departments & Services.
 *
 * Serializer shapes are provisional pending Hub UI's final diff (#565 / #566).
 * All response types live here. Serializers stay in src/lib/departments/shape.ts
 * and src/lib/services/present.ts so the final swap stays small.
 *
 * Not checked against Hub UI's file until they send the final head.
 * Slug is staff_ministries.slug. Money is integer cents. Currency is ZAR.
 */

export type DepartmentCluster = "leadership" | "inward" | "outward" | "backbone" | "alongside";

export type PersonCapacity = "leader" | "member";

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
  purpose: string | null;
  memberCount: number;
  active: boolean;
  /** True when the viewer gets the header and budget only. */
  budgetOnly: boolean;
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
