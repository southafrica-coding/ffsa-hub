/**
 * Departments & Services — UI contract.
 *
 * Pages read this through `src/lib/departments/data.ts` (and the home
 * selectors in `dashboard.ts`). Those functions return mocks until the
 * backend routes exist. Swap the function bodies; keep these types.
 *
 * Expected endpoints (authenticated, the caller's RLS):
 *   GET /api/departments
 *     200 DepartmentSummary[] — homes only
 *   GET /api/departments/:slug
 *     200 DepartmentHome
 *     404 when the slug is unknown or is not a home:
 *       part-time brave_love, hope_again, watchmen, old_age_home;
 *       rooted_christian_academy; no_ministry;
 *       inactive woven, inside_ministry, outside_ministry
 *   GET /api/services
 *     200 HubService[]  — a bare array, no wrapper
 *   GET /api/me/home
 *     200 HomeDashboard
 *
 * `slug` is `staff_ministries.slug` exactly (`prayer_and_worship`).
 * There is no hyphenated alias.
 * `donors_dev` is folded into `finances_legal` (see `FOLDED_INTO`).
 * Money is integer cents. The UI formats whole rands.
 */

export type DepartmentCluster =
  | "leadership"
  | "inward"
  | "outward"
  | "backbone"
  | "alongside";

export type PersonCapacity = "leader" | "member";

export interface DepartmentPerson {
  name: string;
  capacity: PersonCapacity;
  /** Title as recorded. Omit when the roster has none. */
  role?: string;
  isLeader: boolean;
  isPointLeader: boolean;
  /** Hidden unless the viewer may see emails. */
  email: string | null;
}

export interface DepartmentSummary {
  /** `staff_ministries.slug`, used as the URL slug. */
  slug: string;
  name: string;
  cluster: DepartmentCluster | null;
  /**
   * Parent ministry slug when this home sits under another home
   * (`education` → `training`). A fold is not expressed here.
   */
  parentSlug: string | null;
  purpose: string | null;
  memberCount: number;
  active: boolean;
}

export interface DepartmentTool {
  label: string;
  href: string;
  /** Module id from `src/config/modules.ts`. */
  moduleId: string;
}

export type RockStatus = "on_track" | "off_track" | "done";

export interface Rock {
  id: string;
  departmentSlug: string;
  title: string;
  owner: string;
  status: RockStatus;
  /** Calendar date `YYYY-MM-DD` in Africa/Johannesburg, or null when unset. */
  dueOn: string | null;
  quarter: string;
}

export interface DepartmentBudgetLink {
  /** Null when the row is not tied to a finance project yet. */
  projectId: string | null;
  name: string;
  budgetCents: number;
  spentCents: number;
  /** South Africa only. No other currency is shown. */
  currency: "ZAR";
}

export interface DepartmentBudget {
  departmentSlug: string;
  /** Empty when nothing is linked. The whole budget is null when the viewer cannot see it. */
  links: DepartmentBudgetLink[];
}

export type OkrTone =
  | "complete"
  | "in_progress"
  | "moving_forward"
  | "not_started"
  | "stuck";

export interface OkrObjective {
  title: string;
  tone: OkrTone;
}

export interface DepartmentOkrs {
  departmentSlug: string;
  cycleName: string;
  cycleSlug: string;
  /** Existing OKR wall for the current cycle. */
  href: string;
  objectives: OkrObjective[];
}

/**
 * How a department relates to a service.
 * Backend capabilities: own → owner, manage → manager, use → access, moderate → moderator.
 */
export type ServiceDepartmentRole = "owner" | "manager" | "access" | "moderator";

export interface ServiceDepartmentLink {
  /** `staff_ministries.slug`. */
  slug: string;
  role: ServiceDepartmentRole;
}

/** Who the service is for. Separate from department roles. */
/**
 * `open_to_all` is the prod name for a base-wide service.
 * `point_leaders` is Contacts. `owners_only` is Communications.
 */
export type ServiceAudience = "open_to_all" | "point_leaders" | "owners_only";

/** Roles that put a service on a department's "Services we run" tab. */
export type ServiceRunRole = Exclude<ServiceDepartmentRole, "access">;

export interface DepartmentServiceRun {
  serviceId: string;
  role: ServiceRunRole;
}

/** A ministry folded into a home. Not itself a department home. */
export interface SubMinistry {
  slug: string;
  name: string;
  purpose: string;
  memberCount: number;
  people: DepartmentPerson[];
}

export interface HubService {
  id: string;
  name: string;
  summary: string;
  href: string;
  /** Module id whose existing access rule gates the card. */
  moduleId: string;
  /** Every department related to this service. */
  owners: ServiceDepartmentLink[];
  audience: ServiceAudience;
}

export interface OkrCheckIn {
  id: string;
  departmentSlug: string;
  cycleName: string;
  dueOn: string;
  completed: boolean;
  href: string;
}

export interface DepartmentMembership {
  /** `staff_ministries.slug`. */
  slug: string;
  active: boolean;
  isLeader: boolean;
  isPointLeader: boolean;
}

export interface DepartmentViewer {
  name: string;
  /** Unscoped admin (`is_admin()`). */
  isAdmin: boolean;
  roles: string[];
  /** Module ids from the caller's permission rows. */
  permittedModules: string[];
  /**
   * Permission keys and role names used for finance.
   * Includes `finance_admin`, `finance.view`, and `finance.edit`.
   */
  permissions: string[];
  memberships: DepartmentMembership[];
  /**
   * Services this person opens. Empty until usage is recorded.
   * "Services I use" stays empty rather than guessing from access.
   */
  usedServiceIds: string[];
}

/**
 * Flags for one department and one viewer.
 * Backend can return the same object later; the UI computes it until then.
 */
export interface DepartmentAccess {
  /** Full page: active member of this ministry, active Leadership member, or admin. */
  canSeeDepartmentDetail: boolean;
  /** Budget tab. False hides the tab and nulls `budget`. */
  canSeeBudget: boolean;
  canEditRocks: boolean;
  canEditBudget: boolean;
  /** Leaders, point leaders, and admin. Otherwise emails are omitted. */
  canSeePeopleEmails: boolean;
}

export interface DepartmentHome {
  department: DepartmentSummary;
  /**
   * Null in budget-only mode. Empty when the roster has no rows.
   * The page treats null and empty the same: it does not invent people.
   */
  people: DepartmentPerson[] | null;
  okrs: DepartmentOkrs | null;
  rocks: Rock[] | null;
  /** Null when the viewer cannot see figures. No error is shown. */
  budget: DepartmentBudget | null;
  tools: DepartmentTool[];
  /** Services this department owns, manages, or moderates. Access is omitted. Null in budget-only mode. */
  servicesRun: DepartmentServiceRun[] | null;
  /** Ministries explicitly folded into this home. Null in budget-only mode. */
  subMinistries: SubMinistry[] | null;
}

export type DepartmentTab =
  | "overview"
  | "people"
  | "okrs"
  | "rocks"
  | "budget"
  | "services"
  | "tools";

export interface ListedService extends HubService {
  /** Managing departments, or moderators when nobody owns or manages it. */
  managingLabel: string;
  canOpen: boolean;
}

export interface DepartmentServiceListing extends ListedService {
  role: ServiceRunRole;
}

export interface DepartmentTabLink {
  key: DepartmentTab;
  label: string;
  href: string;
}

/** What `/departments/[slug]` renders. Tools are already permission-filtered. */
export interface DepartmentPageModel {
  department: DepartmentSummary;
  parent: DepartmentSummary | null;
  people: DepartmentPerson[] | null;
  leaders: DepartmentPerson[] | null;
  okrs: DepartmentOkrs | null;
  rocks: Rock[] | null;
  budget: DepartmentBudget | null;
  tools: DepartmentTool[];
  services: DepartmentServiceListing[] | null;
  servicesRun: DepartmentServiceRun[] | null;
  subMinistries: SubMinistry[] | null;
  access: DepartmentAccess;
  tabs: DepartmentTabLink[];
  quarter: string;
}

export interface HomeDashboard {
  departments: DepartmentSummary[];
  services: ListedService[];
  rocksDue: Rock[];
  okrCheckInsDue: OkrCheckIn[];
}
