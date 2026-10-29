-- ============================================================
-- FFSA Hub — Migration 272: archive / delete outreach teams,
-- and fill in empty role descriptions
-- ============================================================
-- Safe to run twice: every statement is IF NOT EXISTS / OR REPLACE /
-- DROP ... IF EXISTS, and the description updates only touch rows
-- whose description is still empty.
--
-- 1. OUTREACH TEAMS
--
--    Who counts as an outreach administrator is NOT new: it is
--    public.is_outreach_staff_editor() from migration 260 — Super Admin,
--    General Admin, the finance_admin role, or a finance.edit grant. The
--    same people already edit every team and approve closeouts.
--
--    * Creating a team: unchanged. Anyone signed in may still start one
--      and becomes its owner (migration 260); this migration does not
--      touch the "Create outreach teams" INSERT policy.
--    * Archiving: outreach administrators set archived_at. Archived teams
--      drop out of the normal lists (the Hub dashboard, a member's
--      "my outreaches", the Slack pickers) but keep every record, and an
--      administrator can unarchive them. A trigger stops anyone else —
--      including an owner using the ordinary update policy — from
--      touching archived_at / archived_by.
--    * Deleting: outreach administrators, and ONLY when nothing would be
--      lost. Every table hanging off a team cascades on delete, so a
--      delete would silently wipe budgets, expenses, receipts and cash
--      records. delete_outreach_team() refuses unless the team has no
--      linked records and nobody on it but its owner; otherwise the app
--      offers Archive instead. There is still no DELETE policy on
--      outreach_teams, so the RPC is the only way in.
--
-- 2. ROLE DESCRIPTIONS
--
--    Roles made on the Roles page can be saved without a description,
--    which leaves admins guessing what a job title is for. Fill in every
--    empty one — never overwrite text someone wrote:
--      * roles this codebase created get their original wording back;
--      * any other role gets a plain summary of its permission bundle.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1a. Archive columns
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.outreach_teams
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_outreach_teams_archived
  ON public.outreach_teams(archived_at)
  WHERE archived_at IS NOT NULL;


-- ────────────────────────────────────────────────────────────
-- 1b. Only outreach administrators archive / unarchive
-- ────────────────────────────────────────────────────────────
-- Leaders may update their own team row (migration 260), so the column
-- guard has to live in a trigger. A NULL auth.uid() is the service role
-- or the SQL editor, which are trusted.
CREATE OR REPLACE FUNCTION public.outreach_team_guard_archive()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.archived_at IS DISTINCT FROM OLD.archived_at
      OR NEW.archived_by IS DISTINCT FROM OLD.archived_by)
     AND auth.uid() IS NOT NULL
     AND NOT public.is_outreach_staff_editor() THEN
    RAISE EXCEPTION 'Only admins and finance staff can archive an outreach team'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_outreach_team_guard_archive ON public.outreach_teams;
CREATE TRIGGER trg_outreach_team_guard_archive
  BEFORE UPDATE ON public.outreach_teams
  FOR EACH ROW EXECUTE FUNCTION public.outreach_team_guard_archive();

CREATE OR REPLACE FUNCTION public.set_outreach_team_archived(p_team uuid, p_archived boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_outreach_staff_editor() THEN
    RAISE EXCEPTION 'Only admins and finance staff can archive an outreach team'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.outreach_teams WHERE id = p_team) THEN
    RAISE EXCEPTION 'Outreach team not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_archived THEN
    UPDATE public.outreach_teams
    SET archived_at = now(), archived_by = auth.uid()
    WHERE id = p_team AND archived_at IS NULL;
  ELSE
    UPDATE public.outreach_teams
    SET archived_at = NULL, archived_by = NULL
    WHERE id = p_team;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_outreach_team_archived(uuid, boolean) TO authenticated;


-- ────────────────────────────────────────────────────────────
-- 1c. Delete only when nothing would be lost
-- ────────────────────────────────────────────────────────────
-- What a delete would take with it: { table_name: row_count } for every
-- non-empty linked table, plus "people" for anyone on the roster besides
-- the owner (the owner row is created with the team). '{}' means safe.
-- NULL when the caller isn't an outreach administrator.
CREATE OR REPLACE FUNCTION public.outreach_team_delete_blockers(p_team uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_table  text;
  v_count  bigint;
BEGIN
  IF NOT public.is_outreach_staff_editor() THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.outreach_team_members
  WHERE team_id = p_team AND role <> 'owner';
  IF v_count > 0 THEN
    v_result := v_result || jsonb_build_object('people', v_count);
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'outreach_team_budgets', 'outreach_budget_lines', 'outreach_budget_imports',
    'outreach_day_plans', 'outreach_fund_releases', 'outreach_cash_batches',
    'outreach_cash_allocations', 'outreach_expenses', 'outreach_expense_imports',
    'outreach_closeouts', 'outreach_receipt_drafts'
  ] LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE team_id = $1', v_table)
        INTO v_count USING p_team;
      IF v_count > 0 THEN
        v_result := v_result || jsonb_build_object(v_table, v_count);
      END IF;
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.outreach_team_delete_blockers(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_outreach_team(p_team uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blockers jsonb;
BEGIN
  IF NOT public.is_outreach_staff_editor() THEN
    RAISE EXCEPTION 'Only admins and finance staff can delete an outreach team'
      USING ERRCODE = '42501';
  END IF;
  -- Lock the row so nothing is added between the check and the delete.
  PERFORM 1 FROM public.outreach_teams WHERE id = p_team FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Outreach team not found' USING ERRCODE = 'P0002';
  END IF;

  v_blockers := public.outreach_team_delete_blockers(p_team);
  IF v_blockers <> '{}'::jsonb THEN
    RAISE EXCEPTION 'This team has linked records, so it can only be archived: %', v_blockers
      USING ERRCODE = '23503';
  END IF;

  DELETE FROM public.outreach_teams WHERE id = p_team;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_outreach_team(uuid) TO authenticated;


-- ────────────────────────────────────────────────────────────
-- 1d. A member's own list leaves archived teams out
-- ────────────────────────────────────────────────────────────
-- Same as migration 260, plus the archived_at filter.
CREATE OR REPLACE FUNCTION public.my_outreach_teams()
RETURNS TABLE (
  membership_id uuid,
  role          text,
  team_id       uuid,
  team_name     text,
  location      text,
  country       text,
  status        text,
  start_date    date,
  end_date      date,
  program_name  text,
  program_code  text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.role, t.id, t.team_name, t.location, t.country, t.status,
         t.start_date, t.end_date, p.name, p.code
  FROM public.outreach_team_members m
  JOIN public.outreach_teams t ON t.id = m.team_id
  LEFT JOIN public.programs p ON p.id = t.program_id
  WHERE m.user_id = auth.uid()
    AND t.archived_at IS NULL
  ORDER BY m.joined_at DESC;
$$;


-- ────────────────────────────────────────────────────────────
-- 2a. Role descriptions — roles this codebase created
-- ────────────────────────────────────────────────────────────
-- The wording each role was created with (migrations 003, 004, 013/084,
-- 127, 131, 137, 157, 213, 248). Applied only where it has since gone
-- missing.
UPDATE public.roles r
SET description = v.description
FROM (VALUES
  ('super_admin',       'Full access to everything in the Hub, including the Records Library, platform settings and roles.'),
  ('admin',             'Same access as a Super Admin, except the Records Library. Can manage people, events, finance, users and roles.'),
  ('events_admin',      'Manages events, registrations and attendance.'),
  ('program_leader',    'Manages the programs they are assigned to: enrolled students, applications and academic records.'),
  ('team_leader',       'Manages the teams they are assigned to and the people on them.'),
  ('staff',             'Base staff member. Can view the people directory and events.'),
  ('student',           'Enrolled in a program. Mostly sees their own records.'),
  ('self_service',      'Minimal access. Can view their own profile, registrations and attendance.'),
  ('finance_admin',     'Manages staff fees, rent, school fees, support levels and every outreach budget.'),
  ('comms_admin',       'Manages announcements, partner updates and internal communications.'),
  ('mission_leader',    'Manages outreach trips, visiting teams and impact statistics.'),
  ('prayer_room_admin', 'Coordinates the prayer room: the schedule, the directory and who evaluates whom.'),
  ('ministry_leader',   'Leads one or more ministries: manages that ministry''s roster and sets its Point Leader.'),
  ('vehicle_manager',   'Manages vehicle bookings: approves or declines requests and manages vehicles and settings.'),
  ('booking_manager',   'Manages space bookings: approves or declines requests and manages venues and settings.'),
  ('leadership_team',   'Leadership Team member. Given automatically from Leadership Team ministry membership; can request space bookings and sees staff decisions.'),
  ('community_member',  'Community member. Minimal self-service access.'),
  ('legal_admin',       'Read-only access to the Legal console: who signed which policy and version, with print and CSV export.'),
  ('finance_office',    'Runs year-end donor statements for FF SA USA, INC. Does not include outreach finance, school fees or the Xero connection.')
) AS v(name, description)
WHERE r.name = v.name
  AND (r.description IS NULL OR btrim(r.description) = '');


-- ────────────────────────────────────────────────────────────
-- 2b. Role descriptions — everything else, from its bundle
-- ────────────────────────────────────────────────────────────
-- e.g. "Gives access to Finance (View Finance, Edit Finance Records);
-- Events (View Events)." A role with an empty bundle says so plainly.
WITH by_module AS (
  SELECT rp.role_id,
         p.module,
         string_agg(p.display_name, ', ' ORDER BY p.sort_order, p.display_name) AS names
  FROM public.role_permissions rp
  JOIN public.permissions p ON p.id = rp.permission_id
  GROUP BY rp.role_id, p.module
),
summary AS (
  SELECT role_id,
         string_agg(
           CASE module
             WHEN 'schools'  THEN 'Training'
             WHEN 'ministry' THEN 'Ministries'
             WHEN 'okrs'     THEN 'OKRs'
             ELSE initcap(replace(replace(module, '-', ' '), '_', ' '))
           END || ' (' || names || ')',
           '; ' ORDER BY module
         ) AS text
  FROM by_module
  GROUP BY role_id
)
UPDATE public.roles r
SET description = CASE
  WHEN s.text IS NULL THEN 'Job title only. It gives no extra access on its own.'
  ELSE 'Gives access to ' || s.text || '.'
END
FROM public.roles r2
LEFT JOIN summary s ON s.role_id = r2.id
WHERE r.id = r2.id
  AND (r.description IS NULL OR btrim(r.description) = '');


-- ============================================================
-- Verify:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'outreach_teams' AND column_name LIKE 'archived%';
--
--   SELECT name, display_name, description FROM public.roles ORDER BY name;
--   -- no row should have an empty description
-- ============================================================
