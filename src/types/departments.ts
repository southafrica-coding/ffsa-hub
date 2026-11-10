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
}

export interface DepartmentSummary {
  /** `staff_ministries.slug`, used as the URL slug. */
  slug: string;
  name: string;
  cluster: DepartmentCluster;
  /**
   * Parent ministry slug when this home sits under another home
   * (`education` → `training`). A fold is not expressed here.
   */
  parentSlug: string | null;
  purpose: string;
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
  /** Calendar date `YYYY-MM-DD`, read in Africa/Johannesburg. */
  dueOn: string;
  quarter: string;
}

export interface DepartmentBudget {
  departmentSlug: string;
  /**
   * Null when no finance project is linked.
   * Amounts are integer cents (ZAR).
   */
  project: null | {
    name: string;
    budgetCents: number;
    spentCents: number;
  };
}

export type OkrTone = "on_track" | "stuck" | "not_started";

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
export type ServiceAudience = "all_signed_in" | "ministry_leaders" | "owners_only";

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
  departmentSlug: string;
  capacity: PersonCapacity;
}

export interface DepartmentViewer {
  name: string;
  roles: string[];
  /** Module ids from the caller's permission rows. */
  permittedModules: string[];
  memberships: DepartmentMembership[];
  /**
   * Services this person opens. Empty until usage is recorded.
   * "Services I use" stays empty rather than guessing from access.
   */
  usedServiceIds: string[];
}

export interface DepartmentHome {
  department: DepartmentSummary;
  people: DepartmentPerson[];
  okrs: DepartmentOkrs;
  rocks: Rock[];
  budget: DepartmentBudget;
  tools: DepartmentTool[];
  /** Services this department owns, manages, or moderates. Access is omitted. */
  servicesRun: DepartmentServiceRun[];
  /** Ministries explicitly folded into this home. */
  subMinistries: SubMinistry[];
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
  people: DepartmentPerson[];
  leaders: DepartmentPerson[];
  okrs: DepartmentOkrs;
  rocks: Rock[];
  budget: DepartmentBudget;
  tools: DepartmentTool[];
  services: DepartmentServiceListing[];
  subMinistries: SubMinistry[];
  tabs: DepartmentTabLink[];
  quarter: string;
}

export interface HomeDashboard {
  departments: DepartmentSummary[];
  services: ListedService[];
  rocksDue: Rock[];
  okrCheckInsDue: OkrCheckIn[];
}
