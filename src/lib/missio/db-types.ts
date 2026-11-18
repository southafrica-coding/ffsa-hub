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

/**
 * House churches, membership, and the import-review queue.
 *
 * Shapes follow migration 331 (PR 612, head d01a780fd59b8fe1bb5fcb11b1410e655b080569).
 * That migration is not on main and is not applied here. Do not add these
 * tables to src/types/database.ts by hand.
 *
 * RLS on house_churches, house_church_members, and missio_import_review is
 * has_org_role('missio', ARRAY['pastor']) plus the missio org id. is_admin(),
 * has_role(), and has_any_role() are not consulted. Pastors may insert,
 * update, and delete houses and memberships. On missio_import_review they
 * may SELECT and UPDATE only status, resolved_contact_id, notes,
 * resolved_by, and resolved_at. INSERT and DELETE on that table are
 * service-role only. updated_at is maintained by handle_updated_at().
 *
 * An open membership is ended_at IS NULL (partial unique index
 * house_church_members_active_house_contact_uidx). A current membership,
 * which is what missio_member_status and is_missio_member count, is an
 * open row with started_at <= today and an org_people row in that org.
 * ended_at after today raises 23514 missio_ended_at_in_future from
 * guard_house_church_member. A contact who is not in org_people for the
 * house org raises 23503 missio_member_not_in_org, including for the
 * service role. Ending a row sets ended_at to today. org_people is not written
 * by the database. There is no member-status column on org_people.
 * Authenticated inserts pin created_by to auth.uid(). An authenticated
 * review resolve may only point resolved_contact_id at a candidate or at
 * someone in org_people for that org, and resolved_by is pinned to auth.uid().
 */

export type HouseChurchMemberRole = "leader" | "co_leader" | "member";

export type HouseMeetingDay =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type HouseChurchRow = {
  id: string;
  org_id: string;
  /** CHECK (number > 0). UNIQUE (org_id, number). Seeded 1..20, campus potch. */
  number: number;
  name: string | null;
  /** NOT NULL. DEFAULT 'potch'. CHECK (campus IN ('potch', 'jhb')). */
  campus: OrgCampus;
  /** CHECK (meeting_day IS NULL OR meeting_day IN the seven weekday names). */
  meeting_day: HouseMeetingDay | null;
  location: string | null;
  leader_notes: string | null;
  created_at: string;
  updated_at: string;
};

export type HouseChurchMemberRow = {
  id: string;
  house_church_id: string;
  contact_id: string;
  /** CHECK (role IN ('leader', 'co_leader', 'member')). */
  role: HouseChurchMemberRole;
  /** NOT NULL. DEFAULT current_date. */
  started_at: string;
  /**
   * CHECK (ended_at IS NULL OR ended_at >= started_at).
   * Null is the open, current row. A date on or before today has ended.
   * A date after today raises 23514 missio_ended_at_in_future.
   */
  ended_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MissioImportReviewStatus = "pending" | "matched" | "new" | "skipped";

export type MissioImportReviewRow = {
  id: string;
  org_id: string;
  /** NOT NULL. 1-based sheet line. Not unique by itself. */
  source_line: number;
  raw_name: string;
  /** NOT NULL. No check that the number exists; the importer looks the house up. */
  house_number: number;
  role: HouseChurchMemberRole;
  /** Free text. No check constraint. */
  kind: string | null;
  /** Free text. No check constraint. The importer uses none, multiple, family_label, first_only, partial, non_missio_contact. */
  match_type: string | null;
  /** NOT NULL. DEFAULT '{}'. */
  candidate_contact_ids: string[];
  /**
   * NOT NULL. DEFAULT 'pending'.
   * CHECK (status IN ('pending', 'matched', 'new', 'skipped')).
   * CONSTRAINT missio_import_review_matched_contact_check:
   * status <> 'matched' OR resolved_contact_id IS NOT NULL.
   * CONSTRAINT missio_import_review_source_name_key:
   * UNIQUE (org_id, source_line, raw_name).
   */
  status: MissioImportReviewStatus;
  resolved_contact_id: string | null;
  notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * public.missio_member_status. security_invoker view. No name columns.
 * is_member is always true. One row per contact with a current membership.
 */
export type MissioMemberStatusRow = {
  org_id: string;
  contact_id: string;
  active_house_count: number;
  house_numbers: number[];
  roles: string[];
  is_member: true;
};
