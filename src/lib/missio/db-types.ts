/**
 * Local stand-ins for the Missio org tables.
 *
 * TODO: switch to generated types once draft PR 599 merges
 * (branch cursor/missio-org-phase0-data, migration 329_missio_org_phase0.sql,
 * head 36285f3e). That file does not yet define org_people_directory.
 * The view below follows the post-review requirement: safe name columns
 * only, filtered by has_org_role_id(org_id), SELECT for authenticated.
 * INSERT on org_people stays service-role only.
 *
 *   has_org_role(p_org_slug text, p_roles text[] default null) → boolean
 *   has_org_role_id(p_org_id uuid, p_roles text[] default null) → boolean
 *   NULL p_roles means any org_staff_roles row. Neither function consults
 *   is_admin() or super_admin.
 *
 * Do not import src/types/database.ts for these tables — they are not on
 * main yet, and a hand-edit of the generated file would be overwritten.
 */

export type OrgSlug = "ffsa" | "missio";

export type OrgCampus = "potch" | "jhb";

export type OrgPersonStatus = "visitor" | "active" | "inactive";

export type OrgStaffRoleName =
  | "pastor"
  | "admin"
  | "house_church_leader"
  | "team_leader"
  | "finance";

export type OrganisationRow = {
  id: string;
  slug: string;
  name: string;
  contact_label_id: string | null;
  created_at: string;
};

export type OrgStaffRoleRow = {
  id: string;
  user_id: string;
  org_id: string;
  role: OrgStaffRoleName;
  /**
   * potch, jhb, or null (every campus). Informational in Phase 0.
   * Routes do not filter people or grants by this value.
   */
  campus: OrgCampus | null;
  granted_by: string | null;
  created_at: string;
};

export type OrgPersonRow = {
  id: string;
  org_id: string;
  contact_id: string;
  campus: OrgCampus;
  status: OrgPersonStatus;
  joined_at: string | null;
  current_stage: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * public.org_people_directory. Owner-rights view of org_people plus the
 * contact's name only. No notes, date of birth, address, email, or phone.
 * Filtered by has_org_role_id(org_id). Read with the user client.
 */
export type OrgPeopleDirectoryRow = {
  id: string;
  org_id: string;
  contact_id: string;
  campus: OrgCampus;
  status: OrgPersonStatus;
  joined_at: string | null;
  current_stage: string | null;
  created_at: string;
  updated_at: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
};
