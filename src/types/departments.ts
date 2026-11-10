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
 *     200 HubService[]
 *   GET /api/me/home
 *     200 HomeDashboard
 *
 * URL slugs are hyphenated (`prayer-worship`).
 * `ministrySlug` is `staff_ministries.slug` (`prayer_and_worship`).
 * Money is whole rands (ZAR), South Africa only — not cents.
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
  /** Canonical URL slug. */
  slug: string;
  /** `staff_ministries.slug`. */
  ministrySlug: string;
  name: string;
  cluster: DepartmentCluster;
  /** Parent home URL slug, when this ministry sits under another. */
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
   * Amounts are whole rands (ZAR).
   */
  project: null | {
    name: string;
    budgetRand: number;
    spentRand: number;
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

export interface HubService {
  id: string;
  name: string;
  summary: string;
  href: string;
  /** Module id whose existing access rule gates the card. */
  moduleId: string;
  /** Owning department URL slug, or null when ownership is unset. */
  ownerSlug: string | null;
  /** True when the plan still marks that owner as assumed. */
  ownerAssumed: boolean;
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
  ownedServiceIds: string[];
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
  ownerLabel: string;
  canOpen: boolean;
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
  services: ListedService[];
  tabs: DepartmentTabLink[];
  quarter: string;
}

export interface HomeDashboard {
  departments: DepartmentSummary[];
  services: ListedService[];
  rocksDue: Rock[];
  okrCheckInsDue: OkrCheckIn[];
}
