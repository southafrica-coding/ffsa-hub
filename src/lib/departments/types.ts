// Local stand-ins for the Departments & Services tables.
//
// TODO(hub-data): swap these for Database["public"]["Tables"][...]["Row"]
// once `supabase gen types` includes the migration. Repository functions in
// src/lib/departments/repository.ts and src/lib/services/repository.ts are
// the only `.from(...)` calls, so a renamed column is a one-file change.
//
// ASSUMED — not on main, and not in any open PR as of this branch:
//
//   rocks (L10 rocks, one row per rock, scoped to a staff ministry and a quarter)
//     id                 uuid
//     staff_ministry_id  uuid  → staff_ministries.id
//     quarter            text  'YYYY-Q[1-4]'   e.g. 2026-Q4
//     title              text
//     description        text null
//     owner_user_id      uuid null → users.id
//     status             text  'on_track' | 'off_track' | 'done'
//     due_on             date null
//     created_by         uuid null → users.id
//     created_at         timestamptz
//     updated_at         timestamptz
//
//   department_budget_links (a ministry's finance project, plus the figures)
//     id                  uuid
//     staff_ministry_id   uuid → staff_ministries.id
//     finance_project_id  uuid → finance_projects.id
//     budget_cents        integer   editable here
//     spend_cents         integer   reported, never written by this API
//     currency            text      e.g. ZAR
//     notes               text null
//     updated_at          timestamptz
//     updated_by          uuid null → users.id
//
//   service_owners (who may manage / use / moderate a service, and who owns it)
//     id                 uuid
//     service_key        text   e.g. communications, contacts, evangelism, gear_hire
//     staff_ministry_id  uuid null → staff_ministries.id
//                        null when any_point_leader is true
//     capability         text   'manage' | 'use' | 'moderate' | 'own'
//     member_role        text   'member' | 'leader'
//                        minimum staff_ministry_members.member_role required
//     any_point_leader   boolean
//                        true = any active ministry leader, ignoring staff_ministry_id
//     admin_href         text null
//
// CONFIRMED on main (migrations 126, 182, 250, 290). staff_ministries is not
// in src/types/database.ts yet, so these reads are typed here too:
//
//   staff_ministries: id, name, slug, description, is_active, ministry_type, sort_order
//   staff_ministry_members: id, staff_ministry_id, user_id, member_role,
//                           is_point_leader, status
//   reporting_lines: id, staff_ministry_id, leader_user_id, kind, label,
//                    starts_on, ends_on
//   okr_cycles: id, name, slug, starts_on, ends_on, is_current
//   okr_objectives: id, cycle_id, scope, staff_ministry_id, title, description,
//                   position, timeline, owner_note, is_archived
//   okr_key_results: id, objective_id, position, label, description,
//                    current_status, current_value, metric_unit, metric_start,
//                    metric_target
//   finance_projects: id, name, org_id, project_type, is_active
//   finance_orgs: id, key, name
//   users: id, first_name, last_name, preferred_name, display_name, email,
//          job_title, is_active
//   user_roles: scope_type, scope_id, roles(name)

export const ROCKS_TABLE = "rocks";
export const BUDGET_LINKS_TABLE = "department_budget_links";
export const SERVICE_OWNERS_TABLE = "service_owners";

/** staff_ministries.slug for the Leadership Team ministry (migration 126). */
export const LEADERSHIP_TEAM_SLUG = "leadership_team";
/** staff_ministries.slug for Finances & Legal (migration 250). */
export const FINANCES_LEGAL_SLUG = "finances_legal";

export const ROCK_STATUSES = ["on_track", "off_track", "done"] as const;
export type RockStatus = (typeof ROCK_STATUSES)[number];

export type ServiceCapability = "manage" | "use" | "moderate" | "own";
export type MemberRole = "member" | "leader";

export type DbError = { message: string };
export type DbResult<T> = { data: T; error: DbError | null };

export type DepartmentRecord = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  ministry_type: string | null;
  sort_order: number;
};

export type PersonRecord = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  display_name: string | null;
  email: string | null;
  job_title: string | null;
};

export type MembershipRecord = {
  id: string;
  staff_ministry_id: string;
  user_id: string;
  member_role: string;
  is_point_leader: boolean;
  status: string;
};

export type ReportingLineRecord = {
  id: string;
  staff_ministry_id: string;
  leader_user_id: string;
  kind: string;
  label: string | null;
  starts_on: string;
  ends_on: string | null;
};

export type OkrCycleRecord = {
  id: string;
  name: string;
  slug: string;
  starts_on: string;
  ends_on: string;
  is_current: boolean;
};

export type OkrObjectiveRecord = {
  id: string;
  cycle_id: string;
  scope: string;
  staff_ministry_id: string | null;
  title: string;
  description: string | null;
  position: number;
  timeline: string | null;
  owner_note: string | null;
  is_archived: boolean;
};

export type OkrKeyResultRecord = {
  id: string;
  objective_id: string;
  position: number;
  label: string | null;
  description: string;
  current_status: string;
  current_value: number | null;
  metric_unit: string | null;
  metric_start: number | null;
  metric_target: number | null;
};

export type RockRow = {
  id: string;
  staff_ministry_id: string;
  quarter: string;
  title: string;
  description: string | null;
  owner_user_id: string | null;
  status: string;
  due_on: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type BudgetLinkRow = {
  id: string;
  staff_ministry_id: string;
  finance_project_id: string;
  budget_cents: number;
  spend_cents: number;
  currency: string | null;
  notes: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

export type FinanceProjectRecord = {
  id: string;
  name: string;
  org_id: string;
  project_type: string | null;
  is_active: boolean;
};

export type FinanceOrgRecord = {
  id: string;
  key: string;
  name: string;
};

/** One service_owners row. staff_ministry_id is null on an any-point-leader grant. */
export type ServiceOwnerRow = {
  id: string;
  service_key: string;
  staff_ministry_id: string | null;
  capability: ServiceCapability;
  member_role: MemberRole;
  any_point_leader: boolean;
  admin_href: string | null;
};

export type DepartmentRef = { id: string; slug: string; name: string };

export type LeaderView = {
  user_id: string;
  name: string;
  email: string | null;
  job_title: string | null;
  is_point_leader: boolean;
};

export type DepartmentOverview = {
  department: DepartmentRef & { purpose: string | null; is_active: boolean };
  leaders: LeaderView[];
  counts: { people: number; leaders: number; rocks: number; objectives: number };
  quarter: string;
  cycle: { id: string; name: string; slug: string; starts_on: string; ends_on: string } | null;
};

export type RosterEntry = {
  membership_id: string;
  user_id: string;
  name: string;
  email: string | null;
  job_title: string | null;
  member_role: string;
  is_point_leader: boolean;
  status: string;
};

export type ReportingLineView = {
  id: string;
  leader_user_id: string;
  leader_name: string;
  kind: string;
  label: string | null;
  starts_on: string;
  ends_on: string | null;
};

export type DepartmentPeople = {
  department: DepartmentRef;
  roster: RosterEntry[];
  reporting_lines: ReportingLineView[];
};

export type KeyResultView = {
  id: string;
  position: number;
  label: string | null;
  description: string;
  current_status: string;
  current_value: number | null;
  metric_unit: string | null;
  metric_start: number | null;
  metric_target: number | null;
};

export type ObjectiveView = {
  id: string;
  title: string;
  description: string | null;
  position: number;
  timeline: string | null;
  owner_note: string | null;
  key_results: KeyResultView[];
};

export type DepartmentOkrs = {
  department: DepartmentRef;
  cycle: OkrCycleRecord | null;
  objectives: ObjectiveView[];
};

export type RockView = {
  id: string;
  staff_ministry_id: string;
  quarter: string;
  title: string;
  description: string | null;
  status: string;
  due_on: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type DepartmentRocks = {
  department: DepartmentRef;
  quarter: string;
  can_edit: boolean;
  rocks: RockView[];
};

export type LeadershipRocks = {
  quarter: string;
  departments: Array<DepartmentRef & { rocks: RockView[] }>;
};

export type BudgetProjectView = {
  id: string;
  name: string;
  org_id: string;
  org_key: string | null;
  org_name: string | null;
  project_type: string | null;
  is_active: boolean;
};

export type BudgetLinkView = {
  id: string;
  budget_cents: number;
  spend_cents: number;
  currency: string;
  notes: string | null;
  project: BudgetProjectView | null;
};

export type DepartmentBudget = {
  department: DepartmentRef;
  can_edit: boolean;
  links: BudgetLinkView[];
};

export type ServiceOwnerView = {
  staff_ministry_id: string;
  slug: string | null;
  name: string | null;
};

export type ServiceOwnership = {
  service_key: string;
  admin_href: string | null;
  owners: ServiceOwnerView[];
};
