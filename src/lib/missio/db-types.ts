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
 * Shapes follow migration 331 (PR 612, head 571555e97ca1f218887f42030f990b6c5b3702b9).
 * That migration is not on main and is not applied here. Do not add these
 * tables to src/types/database.ts by hand.
 *
 * RLS on house_churches, house_church_members, and missio_import_review is
 * has_org_role('missio', ARRAY['pastor']) plus the missio org id. is_admin(),
 * has_role(), and has_any_role() are not consulted. Pastors may insert,
 * update, and delete houses and memberships. On missio_import_review they
 * may SELECT and UPDATE only status, resolved_contact_id, notes,
 * resolved_by, and resolved_at. There is no note column. INSERT and DELETE
 * on that table are service-role only. updated_at is maintained by handle_updated_at().
 *
 * An open membership is ended_at IS NULL (partial unique index
 * house_church_members_active_house_contact_uidx). A current membership,
 * which is what missio_member_status and is_missio_member count, is an
 * open row with started_at <= today and an org_people row in that org.
 * ended_at after today raises 23514 missio_ended_at_in_future from
 * guard_house_church_member. A contact who is not in org_people for the
 * house org raises 23503 missio_member_not_in_org, including for the
 * service role. Ending a row sets ended_at to today. A row whose start is
 * already in the future is removed with DELETE. The guard does not run on
 * DELETE. org_people is not written
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

/**
 * Connect card and follow-up funnel.
 *
 * Shapes follow migration 332 (PR 614, head 28d61f9c03e6363a1e6c1316614e4acb45ee5481),
 * stacked on 331. That migration is not applied here. Do not add these tables
 * to src/types/database.ts by hand.
 *
 * RLS is has_org_role('missio', ARRAY['pastor']) plus the missio org id.
 * is_admin(), has_role(), and has_any_role() are not consulted. An FFSA admin
 * does not pass. Public QR rows are service-role inserts (source qr). Pastors
 * may insert only source manual. There is no anon policy.
 *
 * A connect response does not create a follow-up. Joining a house does not
 * create one either. record_missio_followup_stage() writes kind stage_change
 * (including on insert). Pastors insert kind note only. A service-role
 * note sets changed_by to the pastor. The pin trigger overwrites it
 * when auth.uid() is set. The app must not insert stage_change rows.
 * phone_e164 and matched_at are trigger-owned. matched_contact_id,
 * contact_id, and assigned_leader_contact_id must be null or already
 * in org_people, or the guard raises 23503 missio_contact_not_in_org.
 *
 * Partial uniques: (org_id, contact_id) WHERE contact_id IS NOT NULL, and
 * (connect_response_id) WHERE connect_response_id IS NOT NULL.
 * A row needs contact_id or connect_response_id (or both).
 *
 * missio_followup_effective is security_invoker. effective_stage is joined
 * while the contact has a current Missio house membership, otherwise stage.
 * missio_not_in_house is owner-rights with a security barrier, pastor-gated.
 */

export type ConnectVisitType = "first_time" | "been_a_while" | "regular";

export type ConnectSource = "qr" | "manual" | "pco";

export type FollowupStage = "new" | "contacted" | "visited_house" | "joined";

export type FollowupHistoryKind = "stage_change" | "note";

export type ConnectResponseRow = {
  id: string;
  org_id: string;
  submitted_at: string;
  name: string;
  /** As typed. The trigger fills phone_e164. */
  phone: string;
  /** Set by trigger. Null when phone cannot be parsed. Do not write it. */
  phone_e164: string | null;
  email: string | null;
  visit_type: ConnectVisitType;
  wants_house_church: boolean;
  wants_prayer: boolean;
  prayer_request: string | null;
  notes: string | null;
  service_date: string | null;
  /** DEFAULT 'potch'. CHECK (campus IN ('potch', 'jhb')). */
  campus: OrgCampus;
  matched_contact_id: string | null;
  matched_by: string | null;
  matched_at: string | null;
  source: ConnectSource;
  /** HMAC of an IP or device id. Never a raw IP. */
  rate_key_hash: string | null;
  created_at: string;
  updated_at: string;
};

export type MissioFollowupRow = {
  id: string;
  org_id: string;
  contact_id: string | null;
  connect_response_id: string | null;
  stage: FollowupStage;
  assigned_leader_contact_id: string | null;
  assigned_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type MissioFollowupStageHistoryRow = {
  id: string;
  followup_id: string;
  from_stage: FollowupStage | null;
  to_stage: FollowupStage | null;
  /** DEFAULT auth.uid(). */
  changed_by: string | null;
  changed_at: string;
  notes: string | null;
  kind: FollowupHistoryKind;
};

export type MissioFollowupEffectiveRow = MissioFollowupRow & {
  effective_stage: FollowupStage;
};

/**
 * Pastor-gated owner-rights view. Contact rows expose names only.
 * Card rows expose the typed phone and phone_e164. No email column.
 */
export type MissioNotInHouseRow = {
  source: "contact" | "connect_response";
  contact_id: string | null;
  connect_response_id: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  phone: string | null;
  phone_e164: string | null;
  wants_house_church: boolean | null;
  followup_stage: FollowupStage | null;
  submitted_at: string | null;
};
