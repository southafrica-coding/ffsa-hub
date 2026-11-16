-- ============================================================
-- FFSA Hub — Migration 250: Org structure (step H of the org & OKRs work)
-- ============================================================
-- Read docs/redesign/95-org-okrs-reconciliation.md first. Doc 18 asked for
-- new `teams` / `team_memberships` / OKR tables; this EXTENDS what already
-- exists instead:
--
--   teams              → staff_ministries        (126) + structure columns
--   team_memberships   → staff_ministry_members  (126) + role columns
--   objectives / KRs   → okr_objectives / okr_key_results (182) + columns
--
-- and adds only what is genuinely missing:
--
--   staff_ministry_membership_history  a removed membership is kept, not lost
--   reporting_lines                    who oversees / integrates / walks alongside
--   org_layout                         the chart stores only positions
--   org_changes                        change sets (table only; behaviour = step J)
--   org_edit_log                       every structural edit, trigger-written
--   okr_shepherds                      the OKR Shepherd per ministry per cycle
--   org_import_queue                   the 099 drawing, waiting for a person
--                                      to say who each name is
--
-- "NOTHING IS DELETED" WITHOUT TOUCHING THE READERS.
-- Thirty-odd places read staff_ministry_members and treat "a row exists" as
-- "is a member" — RLS helpers, the leadership_team role trigger (131), the
-- department and No Ministry sync triggers (156/206), the roster pages. Rather
-- than teach every one of them about an ends_on column, a removed membership
-- is COPIED into staff_ministry_membership_history by a BEFORE DELETE trigger
-- and the live row goes as it always has. Every delete path — the roster
-- page, convert-to-community, trigger 206, a user being deleted — is covered
-- without a code change, and every reader stays correct.
--
-- THE IMPORT APPLIES NOTHING ON ITS OWN.
-- 0 of the chart's 171 person boxes were ever linked to a Hub user. Matching
-- by name is a guess, and a membership of the Leadership Team grants a role
-- (131). So every box and every connector lands in org_import_queue with its
-- match and suggestions, and a person with org.manage applies them from
-- /org-chart/import (one by one, or "apply all exact matches"). The apply is a
-- SECURITY DEFINER function so auth.uid() — and so the edit log — records who
-- decided.
--
-- PERMISSION. 099's org.manage is reused rather than adding org.admin (two
-- keys for one act). Its display name changes; grant it to Sample Person 3 and Sample Person 24 in
-- Users & Roles once their chart entries are resolved — neither name matches
-- a Hub user automatically.
--
-- Depends on 099 (org_nodes/org_edges, has_org_chart_manage), 126/195/205
-- (staff ministries), 182 (OKRs). Idempotent: safe to re-paste.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. STRUCTURE ON staff_ministries
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.staff_ministries
  ADD COLUMN IF NOT EXISTS cluster   text,
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.staff_ministries (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purpose   text,
  ADD COLUMN IF NOT EXISTS starts_on date,
  ADD COLUMN IF NOT EXISTS ends_on   date;

ALTER TABLE public.staff_ministries DROP CONSTRAINT IF EXISTS staff_ministries_cluster_check;
ALTER TABLE public.staff_ministries ADD CONSTRAINT staff_ministries_cluster_check
  CHECK (cluster IS NULL OR cluster IN ('leadership', 'outward', 'inward', 'backbone', 'alongside'));

ALTER TABLE public.staff_ministries DROP CONSTRAINT IF EXISTS staff_ministries_parent_not_self;
ALTER TABLE public.staff_ministries ADD CONSTRAINT staff_ministries_parent_not_self
  CHECK (parent_id IS NULL OR parent_id <> id);

ALTER TABLE public.staff_ministries DROP CONSTRAINT IF EXISTS staff_ministries_dates_check;
ALTER TABLE public.staff_ministries ADD CONSTRAINT staff_ministries_dates_check
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on);

COMMENT ON COLUMN public.staff_ministries.cluster IS
  'Where the ministry sits on the org chart: leadership, outward (mission), inward '
  '(formation), backbone (support) or alongside (Missio).';
COMMENT ON COLUMN public.staff_ministries.ends_on IS
  'A ministry is ended, never deleted. On or after this date it is inactive. '
  'NOTE: a FUTURE ends_on does not flip is_active by itself yet — the nightly '
  'org job arrives with change sets (step J).';

-- An ended ministry is inactive. Every existing reader already understands
-- is_active, so this keeps them right without knowing about ends_on.
CREATE OR REPLACE FUNCTION public.staff_ministry_end_sync()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ends_on IS NOT NULL AND NEW.ends_on <= current_date THEN
    NEW.is_active := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_ministry_end_sync ON public.staff_ministries;
CREATE TRIGGER staff_ministry_end_sync
  BEFORE INSERT OR UPDATE OF ends_on ON public.staff_ministries
  FOR EACH ROW EXECUTE FUNCTION public.staff_ministry_end_sync();


-- ────────────────────────────────────────────────────────────
-- 2. ROLE DETAIL ON staff_ministry_members
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.staff_ministry_members
  ADD COLUMN IF NOT EXISTS role_title       text,
  ADD COLUMN IF NOT EXISTS responsibilities text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS share_pct        smallint,
  ADD COLUMN IF NOT EXISTS staff_kind       text NOT NULL DEFAULT 'staff',
  ADD COLUMN IF NOT EXISTS starts_on        date,
  ADD COLUMN IF NOT EXISTS source           text NOT NULL DEFAULT 'hub';

ALTER TABLE public.staff_ministry_members DROP CONSTRAINT IF EXISTS smm_share_pct_check;
ALTER TABLE public.staff_ministry_members ADD CONSTRAINT smm_share_pct_check
  CHECK (share_pct IS NULL OR share_pct BETWEEN 0 AND 100);
ALTER TABLE public.staff_ministry_members DROP CONSTRAINT IF EXISTS smm_staff_kind_check;
ALTER TABLE public.staff_ministry_members ADD CONSTRAINT smm_staff_kind_check
  CHECK (staff_kind IN ('staff', 'volunteer'));
ALTER TABLE public.staff_ministry_members DROP CONSTRAINT IF EXISTS smm_source_check;
ALTER TABLE public.staff_ministry_members ADD CONSTRAINT smm_source_check
  CHECK (source IN ('hub', 'training', 'events', 'chart_import'));

ALTER TABLE public.staff_ministry_members
  ALTER COLUMN starts_on SET DEFAULT current_date;
UPDATE public.staff_ministry_members
   SET starts_on = created_at::date
 WHERE starts_on IS NULL;


-- ────────────────────────────────────────────────────────────
-- 3. MEMBERSHIP HISTORY — removed, not lost
-- ────────────────────────────────────────────────────────────
-- No foreign keys on user / ministry: the history must survive either being
-- deleted, and a cascade from users fires this trigger while the user row is
-- already gone. Names are snapshotted for the same reason.

CREATE TABLE IF NOT EXISTS public.staff_ministry_membership_history (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id     uuid NOT NULL,
  staff_ministry_id uuid NOT NULL,
  ministry_name     text,
  user_id           uuid NOT NULL,
  user_name         text,
  member_role       text NOT NULL,
  is_point_leader   boolean NOT NULL DEFAULT false,
  role_title        text,
  responsibilities  text[] NOT NULL DEFAULT '{}',
  share_pct         smallint,
  staff_kind        text,
  source            text,
  subcategory_names text[] NOT NULL DEFAULT '{}',
  starts_on         date,
  ended_on          date NOT NULL DEFAULT current_date,
  ended_by          uuid,
  ended_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smm_history_user
  ON public.staff_ministry_membership_history (user_id, ended_on DESC);
CREATE INDEX IF NOT EXISTS idx_smm_history_ministry
  ON public.staff_ministry_membership_history (staff_ministry_id, ended_on DESC);

CREATE OR REPLACE FUNCTION public.archive_staff_ministry_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug text;
  v_name text;
BEGIN
  -- A pending request that was turned down was never a membership.
  IF OLD.status <> 'active' THEN
    RETURN OLD;
  END IF;

  SELECT slug, name INTO v_slug, v_name
    FROM public.staff_ministries WHERE id = OLD.staff_ministry_id;

  -- "No Ministry" is a placeholder that trigger 206 empties automatically
  -- whenever someone joins a real ministry; its comings and goings are noise.
  IF v_slug = 'no_ministry' THEN
    RETURN OLD;
  END IF;

  INSERT INTO public.staff_ministry_membership_history (
    membership_id, staff_ministry_id, ministry_name, user_id, user_name,
    member_role, is_point_leader, role_title, responsibilities, share_pct,
    staff_kind, source, subcategory_names, starts_on, ended_by
  )
  SELECT
    OLD.id, OLD.staff_ministry_id, v_name, OLD.user_id,
    (SELECT COALESCE(NULLIF(trim(concat_ws(' ', COALESCE(u.preferred_name, u.first_name), u.last_name)), ''), u.display_name, u.email)
       FROM public.users u WHERE u.id = OLD.user_id),
    OLD.member_role, OLD.is_point_leader, OLD.role_title, OLD.responsibilities,
    OLD.share_pct, OLD.staff_kind, OLD.source,
    -- BEFORE DELETE: the 205 join rows have not cascaded away yet.
    COALESCE((SELECT array_agg(sc.name ORDER BY sc.name)
                FROM public.staff_ministry_member_subcategories j
                JOIN public.staff_ministry_subcategories sc ON sc.id = j.subcategory_id
               WHERE j.membership_id = OLD.id), '{}'),
    OLD.starts_on, auth.uid();

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS archive_staff_ministry_membership ON public.staff_ministry_members;
CREATE TRIGGER archive_staff_ministry_membership
  BEFORE DELETE ON public.staff_ministry_members
  FOR EACH ROW EXECUTE FUNCTION public.archive_staff_ministry_membership();


-- ────────────────────────────────────────────────────────────
-- 4. NEW STRUCTURE TABLES
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.reporting_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_ministry_id uuid NOT NULL REFERENCES public.staff_ministries (id) ON DELETE CASCADE,
  leader_user_id    uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('oversees', 'integrates', 'alongside')),
  label             text,
  starts_on         date NOT NULL DEFAULT current_date,
  ends_on           date,
  created_by        uuid REFERENCES public.users (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reporting_lines_dates_check CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_open_reporting_line
  ON public.reporting_lines (staff_ministry_id, leader_user_id, kind)
  WHERE ends_on IS NULL;
CREATE INDEX IF NOT EXISTS idx_reporting_lines_leader
  ON public.reporting_lines (leader_user_id);

CREATE TABLE IF NOT EXISTS public.org_layout (
  staff_ministry_id uuid PRIMARY KEY REFERENCES public.staff_ministries (id) ON DELETE CASCADE,
  x                 numeric NOT NULL,
  y                 numeric NOT NULL,
  updated_by        uuid REFERENCES public.users (id),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Change sets (42b). Created empty here; proposing, approving and the nightly
-- apply job are step J. The approve-your-own rule is enforced in the table so
-- no future route can forget it.
CREATE TABLE IF NOT EXISTS public.org_changes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  reason       text,
  effective_on date NOT NULL,
  status       text NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft', 'waiting', 'approved', 'live', 'cancelled')),
  steps        jsonb NOT NULL DEFAULT '[]'::jsonb,
  proposed_by  uuid NOT NULL REFERENCES public.users (id),
  approved_by  uuid REFERENCES public.users (id),
  approved_at  timestamptz,
  applied_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_changes_not_self_approved CHECK (approved_by IS NULL OR approved_by <> proposed_by)
);

DROP TRIGGER IF EXISTS set_updated_at ON public.org_changes;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.org_changes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE IF NOT EXISTS public.okr_shepherds (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id          uuid NOT NULL REFERENCES public.okr_cycles (id) ON DELETE CASCADE,
  staff_ministry_id uuid NOT NULL REFERENCES public.staff_ministries (id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, staff_ministry_id)
);


-- ────────────────────────────────────────────────────────────
-- 5. THE EDIT LOG
-- ────────────────────────────────────────────────────────────
-- Same shape of decision as okr_events (197): trigger-written only, so nobody
-- can forge or rewrite it. OKR edits keep going to okr_events; this covers
-- structure. before/after are jsonb so step J's undo can write a value back
-- exactly.

CREATE TABLE IF NOT EXISTS public.org_edit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  row_id     uuid NOT NULL,
  action     text NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  field      text,
  before     jsonb,
  after      jsonb,
  actor_id   uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_edit_log_row
  ON public.org_edit_log (table_name, row_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_edit_log_recent
  ON public.org_edit_log (created_at DESC);

CREATE OR REPLACE FUNCTION public.log_org_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor  uuid := auth.uid();
  old_j  jsonb;
  new_j  jsonb;
  k      text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.org_edit_log (table_name, row_id, action, after, actor_id)
      VALUES (TG_TABLE_NAME, NEW.id, 'created', to_jsonb(NEW), actor);
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.org_edit_log (table_name, row_id, action, before, actor_id)
      VALUES (TG_TABLE_NAME, OLD.id, 'deleted', to_jsonb(OLD), actor);
    RETURN NULL;
  END IF;

  old_j := to_jsonb(OLD);
  new_j := to_jsonb(NEW);
  FOR k IN SELECT jsonb_object_keys(new_j) LOOP
    CONTINUE WHEN k IN ('updated_at', 'created_at');
    IF (old_j -> k) IS DISTINCT FROM (new_j -> k) THEN
      INSERT INTO public.org_edit_log (table_name, row_id, action, field, before, after, actor_id)
        VALUES (TG_TABLE_NAME, NEW.id, 'updated', k, old_j -> k, new_j -> k, actor);
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS org_edit_log ON public.staff_ministries;
CREATE TRIGGER org_edit_log AFTER INSERT OR UPDATE OR DELETE ON public.staff_ministries
  FOR EACH ROW EXECUTE FUNCTION public.log_org_edit();
DROP TRIGGER IF EXISTS org_edit_log ON public.staff_ministry_members;
CREATE TRIGGER org_edit_log AFTER INSERT OR UPDATE OR DELETE ON public.staff_ministry_members
  FOR EACH ROW EXECUTE FUNCTION public.log_org_edit();
DROP TRIGGER IF EXISTS org_edit_log ON public.reporting_lines;
CREATE TRIGGER org_edit_log AFTER INSERT OR UPDATE OR DELETE ON public.reporting_lines
  FOR EACH ROW EXECUTE FUNCTION public.log_org_edit();
DROP TRIGGER IF EXISTS org_edit_log ON public.okr_shepherds;
CREATE TRIGGER org_edit_log AFTER INSERT OR UPDATE OR DELETE ON public.okr_shepherds
  FOR EACH ROW EXECUTE FUNCTION public.log_org_edit();


-- ────────────────────────────────────────────────────────────
-- 6. OKR COLUMNS (182 extended, not replaced)
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.okr_cycles
  ADD COLUMN IF NOT EXISTS review_months smallint[] NOT NULL DEFAULT '{3,6,9,12}',
  ADD COLUMN IF NOT EXISTS reset_on      date;

ALTER TABLE public.okr_objectives
  ADD COLUMN IF NOT EXISTS direction text,
  ADD COLUMN IF NOT EXISTS ended_on  date;
ALTER TABLE public.okr_objectives DROP CONSTRAINT IF EXISTS okr_objectives_direction_check;
ALTER TABLE public.okr_objectives ADD CONSTRAINT okr_objectives_direction_check
  CHECK (direction IS NULL OR direction IN ('presence', 'formation', 'mission', 'multiplication', 'care'));

ALTER TABLE public.okr_key_results
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source        text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS metric_key    text;
ALTER TABLE public.okr_key_results DROP CONSTRAINT IF EXISTS okr_key_results_source_check;
ALTER TABLE public.okr_key_results ADD CONSTRAINT okr_key_results_source_check
  CHECK (source IN ('manual', 'linked') AND (source = 'manual' OR metric_key IS NOT NULL));

-- OKR-only teams (182) are retired: four of the five now exist as part-time
-- staff ministries (195), and production has no objective owned by one.
-- Evangelism is a separate module (statistics + testimonies), not a team.
UPDATE public.okr_teams SET is_active = false WHERE is_active;


-- ────────────────────────────────────────────────────────────
-- 7. PERMISSION — reuse org.manage
-- ────────────────────────────────────────────────────────────

UPDATE public.permissions
   SET display_name = 'Administer org & OKR structure'
 WHERE key = 'org.manage';


-- ────────────────────────────────────────────────────────────
-- 8. RLS
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.staff_ministry_membership_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reporting_lines  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_layout       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_changes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.okr_shepherds    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_edit_log     ENABLE ROW LEVEL SECURITY;

-- History: the same people who could read the live row (126) plus org admins.
-- Written only by the trigger.
DROP POLICY IF EXISTS "Membership history readable" ON public.staff_ministry_membership_history;
CREATE POLICY "Membership history readable"
  ON public.staff_ministry_membership_history FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.leads_staff_ministry(staff_ministry_id)
    OR public.has_org_chart_manage()
  );

-- The chart is readable by everyone signed in; structure is written by org admins.
DROP POLICY IF EXISTS "Reporting lines readable" ON public.reporting_lines;
CREATE POLICY "Reporting lines readable"
  ON public.reporting_lines FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Org admins manage reporting lines" ON public.reporting_lines;
CREATE POLICY "Org admins manage reporting lines"
  ON public.reporting_lines FOR ALL TO authenticated
  USING (public.has_org_chart_manage()) WITH CHECK (public.has_org_chart_manage());

DROP POLICY IF EXISTS "Org layout readable" ON public.org_layout;
CREATE POLICY "Org layout readable"
  ON public.org_layout FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Org admins manage layout" ON public.org_layout;
CREATE POLICY "Org admins manage layout"
  ON public.org_layout FOR ALL TO authenticated
  USING (public.has_org_chart_manage()) WITH CHECK (public.has_org_chart_manage());

DROP POLICY IF EXISTS "OKR shepherds readable" ON public.okr_shepherds;
CREATE POLICY "OKR shepherds readable"
  ON public.okr_shepherds FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Org admins manage OKR shepherds" ON public.okr_shepherds;
CREATE POLICY "Org admins manage OKR shepherds"
  ON public.okr_shepherds FOR ALL TO authenticated
  USING (public.has_org_chart_manage()) WITH CHECK (public.has_org_chart_manage());

-- A change set that went live is public record; drafts and pending ones are
-- for org admins until step J decides who else sees them.
DROP POLICY IF EXISTS "Org changes readable" ON public.org_changes;
CREATE POLICY "Org changes readable"
  ON public.org_changes FOR SELECT TO authenticated
  USING (status = 'live' OR public.has_org_chart_manage());
DROP POLICY IF EXISTS "Org admins manage org changes" ON public.org_changes;
CREATE POLICY "Org admins manage org changes"
  ON public.org_changes FOR ALL TO authenticated
  USING (public.has_org_chart_manage()) WITH CHECK (public.has_org_chart_manage());

-- No write policy for anyone: trigger-only.
DROP POLICY IF EXISTS "Org admins read the edit log" ON public.org_edit_log;
CREATE POLICY "Org admins read the edit log"
  ON public.org_edit_log FOR SELECT TO authenticated
  USING (public.has_org_chart_manage());


-- ────────────────────────────────────────────────────────────
-- 9. THE IMPORT QUEUE
-- ────────────────────────────────────────────────────────────
-- One row per thing on the 099 drawing that should become a fact: every
-- person box, every connector, the Integrator seat. Nothing on the drawing is
-- dropped — each ends up applied, already true, or dismissed by a person.

CREATE TABLE IF NOT EXISTS public.org_import_queue (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind          text NOT NULL CHECK (source_kind IN ('person', 'edge', 'role')),
  source_key           text NOT NULL UNIQUE,   -- node key, or 'edge:<id>'
  chart_label          text NOT NULL,          -- the name as the chart wrote it
  role_title           text,                   -- box subtitle, or the connector's label
  chart_group          text,                   -- the sub-team box it sat in, if any
  staff_ministry_id    uuid REFERENCES public.staff_ministries (id) ON DELETE SET NULL,
  proposal             text NOT NULL CHECK (proposal IN ('membership', 'oversees', 'integrates', 'alongside')),
  match_kind           text NOT NULL CHECK (match_kind IN ('exact', 'first_name', 'ambiguous', 'none')),
  suggested_user_ids   uuid[] NOT NULL DEFAULT '{}',
  status               text NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'applied', 'already_true', 'dismissed')),
  resolved_user_id     uuid REFERENCES public.users (id) ON DELETE SET NULL,
  resolved_proposal    text,
  resolved_ministry_id uuid REFERENCES public.staff_ministries (id) ON DELETE SET NULL,
  resolved_by          uuid REFERENCES public.users (id) ON DELETE SET NULL,
  resolved_at          timestamptz,
  note                 text,
  sort_order           integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_import_queue_status
  ON public.org_import_queue (status, sort_order);

ALTER TABLE public.org_import_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org admins read the import queue" ON public.org_import_queue;
CREATE POLICY "Org admins read the import queue"
  ON public.org_import_queue FOR SELECT TO authenticated
  USING (public.has_org_chart_manage());
-- Writes only through the functions below.


-- ────────────────────────────────────────────────────────────
-- 10. THE IMPORT — 099 drawing → ministries + queue
-- ────────────────────────────────────────────────────────────

-- Name comparison: lower case, common accents folded, punctuation dropped.
CREATE OR REPLACE FUNCTION public.org_norm_name(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(regexp_replace(
           regexp_replace(
             translate(lower(COALESCE(p, '')),
                       'áàâäãéèêëíìîïóòôöõúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
             '[^a-z0-9 ]', '', 'g'),
           '\s+', ' ', 'g'));
$$;

-- Who a chart name could be. Only a single full-name hit is 'exact'; a unique
-- first name is a suggestion, never an identity.
CREATE OR REPLACE FUNCTION public.org_match_user(p_label text)
RETURNS TABLE (match_kind text, user_ids uuid[])
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_l      text := public.org_norm_name(p_label);
  v_first  text := split_part(public.org_norm_name(p_label), ' ', 1);
  v_last   text := regexp_replace(public.org_norm_name(p_label), '^.* ', '');
  full_ids  uuid[];
  first_ids uuid[];
  near_ids  uuid[];
BEGIN
  SELECT COALESCE(array_agg(DISTINCT u.id), '{}') INTO full_ids
    FROM public.users u
   WHERE u.merged_into_user_id IS NULL
     AND v_l IN (
       public.org_norm_name(concat_ws(' ', u.first_name, u.last_name)),
       public.org_norm_name(concat_ws(' ', u.preferred_name, u.last_name)),
       public.org_norm_name(u.display_name)
     );

  IF array_length(full_ids, 1) = 1 THEN
    RETURN QUERY SELECT 'exact'::text, full_ids;
    RETURN;
  ELSIF array_length(full_ids, 1) > 1 THEN
    RETURN QUERY SELECT 'ambiguous'::text, full_ids;
    RETURN;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT u.id), '{}') INTO first_ids
    FROM public.users u
   WHERE u.merged_into_user_id IS NULL
     AND v_first IN (public.org_norm_name(u.first_name), public.org_norm_name(u.preferred_name));

  IF position(' ' IN v_l) = 0 THEN
    -- A bare first name ("Sample", "Person").
    IF array_length(first_ids, 1) = 1 THEN
      RETURN QUERY SELECT 'first_name'::text, first_ids;
    ELSIF array_length(first_ids, 1) > 1 THEN
      RETURN QUERY SELECT 'ambiguous'::text, first_ids[1:8];
    ELSE
      RETURN QUERY SELECT 'none'::text, '{}'::uuid[];
    END IF;
    RETURN;
  END IF;

  -- A full name with no full match ("Sample Person"): offer anyone sharing the
  -- first name or the surname, so a misspelling still surfaces the person.
  SELECT COALESCE(array_agg(DISTINCT u.id), '{}') INTO near_ids
    FROM public.users u
   WHERE u.merged_into_user_id IS NULL
     AND (v_first IN (public.org_norm_name(u.first_name), public.org_norm_name(u.preferred_name))
          OR (length(v_last) > 2 AND public.org_norm_name(u.last_name) = v_last));

  RETURN QUERY SELECT 'none'::text, near_ids[1:8];
END;
$$;

DO $$
DECLARE
  v_chart uuid;
BEGIN
  SELECT id INTO v_chart FROM public.org_charts WHERE slug = 'ffsa-2026';
  IF v_chart IS NULL THEN
    RAISE NOTICE 'No ffsa-2026 chart — nothing to import.';
    RETURN;
  END IF;

  -- Chart box → staff ministry. Explicit, never fuzzy.
  CREATE TEMP TABLE _org_map (key text PRIMARY KEY, slug text, name text, cluster text, parent_slug text)
    ON COMMIT DROP;
  INSERT INTO _org_map VALUES
    ('leadership',     'leadership_team',          'Leadership Team',          'leadership', NULL),
    ('team-outside',   'outside_ministry',         'Outside Ministry',         'outward',    NULL),
    ('team-hulc',      'hulk',                     'HULC',                     'outward',    NULL),
    ('team-events',    'events',                   'Events',                   'outward',    NULL),
    ('team-p54',       'project_54',               'Project 54',               'outward',    NULL),
    ('team-crossfit',  '1040',                     '1040',                     'outward',    NULL),
    ('team-woven',     'woven',                    'Woven',                    'outward',    NULL),
    ('team-inside',    'inside_ministry',          'Inside Ministry',          'inward',     NULL),
    ('team-training',  'training',                 'Training',                 'inward',     NULL),
    ('tr-rca',         'rooted_christian_academy', 'Rooted Christian Academy', 'inward',     'training'),
    ('tr-efl',         'education',                'Ed for Life',              'inward',     'training'),
    ('team-worship',   'prayer_and_worship',       'Prayer & Worship',         'inward',     NULL),
    ('team-ops',       'operations',               'Operations',               'backbone',   NULL),
    ('team-finance',   'finances_legal',           'Finances & Legal',         'backbone',   NULL),
    ('team-donors',    'donors_dev',               'Donors & Dev',             'backbone',   NULL),
    ('team-media',     'media',                    'Media',                    'backbone',   NULL),
    ('missio',         'missio_ministry',          'Missio Ministry',          'alongside',  NULL);

  -- Ministries the chart has and the Hub did not. Main ministries, so they
  -- appear in the department picker like any other.
  INSERT INTO public.staff_ministries (name, slug, ministry_type, sort_order)
  SELECT m.name, m.slug, 'main', 200
    FROM _org_map m
   WHERE NOT EXISTS (SELECT 1 FROM public.staff_ministries s WHERE s.slug = m.slug)
  ON CONFLICT (slug) DO NOTHING;

  -- Cluster and parent, only where nobody has set them yet.
  UPDATE public.staff_ministries s
     SET cluster = m.cluster
    FROM _org_map m
   WHERE s.slug = m.slug AND s.cluster IS NULL;

  UPDATE public.staff_ministries s
     SET parent_id = p.id
    FROM _org_map m
    JOIN public.staff_ministries p ON p.slug = m.parent_slug
   WHERE s.slug = m.slug AND s.parent_id IS NULL;

  -- Woven ends this month: kept, with its end date, so history is right.
  UPDATE public.staff_ministries
     SET ends_on = '2026-10-31'
   WHERE slug = 'woven' AND ends_on IS NULL;

  -- For every chart box: its nearest mapped ancestor (itself included) and the
  -- nearest unmapped sub-team box it sits in.
  CREATE TEMP TABLE _node_home ON COMMIT DROP AS
  WITH RECURSIVE anc AS (
    SELECT n.id AS node_id, n.id AS anc_id, 0 AS depth
      FROM public.org_nodes n WHERE n.chart_id = v_chart
    UNION ALL
    SELECT a.node_id, p.parent_id, a.depth + 1
      FROM anc a JOIN public.org_nodes p ON p.id = a.anc_id
     WHERE p.parent_id IS NOT NULL
  ),
  home AS (
    SELECT DISTINCT ON (a.node_id) a.node_id, s.id AS staff_ministry_id
      FROM anc a
      JOIN public.org_nodes x ON x.id = a.anc_id
      JOIN _org_map m ON m.key = x.key
      JOIN public.staff_ministries s ON s.slug = m.slug
     ORDER BY a.node_id, a.depth
  ),
  grp AS (
    SELECT DISTINCT ON (a.node_id) a.node_id, x.label
      FROM anc a
      JOIN public.org_nodes x ON x.id = a.anc_id
     WHERE x.kind = 'subteam'
       AND NOT EXISTS (SELECT 1 FROM _org_map m WHERE m.key = x.key)
     ORDER BY a.node_id, a.depth
  )
  SELECT n.id AS node_id, n.key, n.kind, n.label, n.subtitle, n.sort_order,
         (SELECT p.key FROM public.org_nodes p WHERE p.id = n.parent_id) AS parent_key,
         h.staff_ministry_id, g.label AS chart_group
    FROM public.org_nodes n
    LEFT JOIN home h ON h.node_id = n.id
    LEFT JOIN grp  g ON g.node_id = n.id
   WHERE n.chart_id = v_chart;

  -- Every person box → a membership to confirm.
  INSERT INTO public.org_import_queue (
    source_kind, source_key, chart_label, role_title, chart_group,
    staff_ministry_id, proposal, match_kind, suggested_user_ids, sort_order
  )
  SELECT 'person', h.key, h.label, h.subtitle, h.chart_group,
         h.staff_ministry_id, 'membership', mu.match_kind, mu.user_ids,
         row_number() OVER (ORDER BY h.staff_ministry_id, h.sort_order, h.label)
    FROM _node_home h
    CROSS JOIN LATERAL public.org_match_user(h.label) mu
   WHERE h.kind = 'person'
  ON CONFLICT (source_key) DO NOTHING;

  -- Every connector. Doc 18 discards cross-team ones, but on the Hub they are
  -- the only record that someone also serves elsewhere — so each becomes a
  -- second membership (or, from a Leadership Team member to the team they
  -- head, an "oversees" line) for a person to confirm.
  INSERT INTO public.org_import_queue (
    source_kind, source_key, chart_label, role_title, chart_group,
    staff_ministry_id, proposal, match_kind, suggested_user_ids, sort_order
  )
  SELECT 'edge', 'edge:' || e.id, src.label, e.label, tgt.chart_group,
         tgt.staff_ministry_id,
         CASE
           WHEN e.kind = 'parallel' THEN 'alongside'
           WHEN src.parent_key = 'leadership'
                AND (public.org_norm_name(e.label) = public.org_norm_name(tgt.label)
                     OR e.label ILIKE '%director%')
             THEN 'oversees'
           ELSE 'membership'
         END,
         mu.match_kind, mu.user_ids,
         1000 + row_number() OVER (ORDER BY src.label)
    FROM public.org_edges e
    JOIN _node_home src ON src.node_id = e.source_id
    JOIN _node_home tgt ON tgt.node_id = e.target_id
    CROSS JOIN LATERAL public.org_match_user(src.label) mu
   WHERE e.chart_id = v_chart
  ON CONFLICT (source_key) DO NOTHING;

  -- The Integrator seat — held by Sample Person 24.
  INSERT INTO public.org_import_queue (
    source_kind, source_key, chart_label, role_title,
    staff_ministry_id, proposal, match_kind, suggested_user_ids, sort_order
  )
  SELECT 'role', h.key, 'Sample Person 24', 'Integrator',
         h.staff_ministry_id, 'integrates', mu.match_kind, mu.user_ids, 2000
    FROM _node_home h
    CROSS JOIN LATERAL public.org_match_user('Sample Person 24') mu
   WHERE h.key = 'integrator'
  ON CONFLICT (source_key) DO NOTHING;
END $$;


-- ────────────────────────────────────────────────────────────
-- 11. APPLYING THE QUEUE
-- ────────────────────────────────────────────────────────────
-- SECURITY DEFINER so an org admin who is not a ministry leader can still
-- write the roster, and so auth.uid() is the decider in the edit log and in
-- added_by. Each checks has_org_chart_manage() itself.

CREATE OR REPLACE FUNCTION public.org_import_apply(
  p_queue_id    uuid,
  p_user_id     uuid,
  p_proposal    text DEFAULT NULL,
  p_ministry_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  q        public.org_import_queue%ROWTYPE;
  v_prop   text;
  v_min    uuid;
  v_status text;
BEGIN
  IF NOT COALESCE(public.has_org_chart_manage(), false) THEN
    RAISE EXCEPTION 'Not authorised to apply the org import';
  END IF;

  SELECT * INTO q FROM public.org_import_queue WHERE id = p_queue_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such import row';
  END IF;
  IF q.status <> 'open' THEN
    RAISE EXCEPTION 'This row is already %', q.status;
  END IF;

  v_prop := COALESCE(p_proposal, q.proposal);
  v_min  := COALESCE(p_ministry_id, q.staff_ministry_id);
  IF v_prop NOT IN ('membership', 'oversees', 'integrates', 'alongside') THEN
    RAISE EXCEPTION 'Unknown proposal %', v_prop;
  END IF;
  IF v_min IS NULL THEN
    RAISE EXCEPTION 'Choose a ministry first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id AND merged_into_user_id IS NULL) THEN
    RAISE EXCEPTION 'Choose a person first';
  END IF;

  IF v_prop = 'membership' THEN
    IF EXISTS (SELECT 1 FROM public.staff_ministry_members
                WHERE staff_ministry_id = v_min AND user_id = p_user_id) THEN
      -- Already on the roster: the roster wins. Only fill a blank title.
      UPDATE public.staff_ministry_members
         SET role_title = q.role_title
       WHERE staff_ministry_id = v_min AND user_id = p_user_id
         AND role_title IS NULL AND q.role_title IS NOT NULL;
      v_status := 'already_true';
    ELSE
      INSERT INTO public.staff_ministry_members (
        staff_ministry_id, user_id, member_role, status, role_title, source,
        added_by, approved_by
      ) VALUES (
        v_min, p_user_id, 'member', 'active', q.role_title, 'chart_import',
        auth.uid(), auth.uid()
      );
      v_status := 'applied';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.reporting_lines
                WHERE staff_ministry_id = v_min AND leader_user_id = p_user_id
                  AND kind = v_prop AND ends_on IS NULL) THEN
      v_status := 'already_true';
    ELSE
      INSERT INTO public.reporting_lines (staff_ministry_id, leader_user_id, kind, label, created_by)
        VALUES (v_min, p_user_id, v_prop, q.role_title, auth.uid());
      v_status := 'applied';
    END IF;
  END IF;

  UPDATE public.org_import_queue
     SET status = v_status,
         resolved_user_id = p_user_id,
         resolved_proposal = v_prop,
         resolved_ministry_id = v_min,
         resolved_by = auth.uid(),
         resolved_at = now()
   WHERE id = p_queue_id;

  RETURN v_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.org_import_apply_exact()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  IF NOT COALESCE(public.has_org_chart_manage(), false) THEN
    RAISE EXCEPTION 'Not authorised to apply the org import';
  END IF;

  FOR r IN
    SELECT id, suggested_user_ids[1] AS user_id
      FROM public.org_import_queue
     WHERE status = 'open'
       AND match_kind = 'exact'
       AND staff_ministry_id IS NOT NULL
       AND array_length(suggested_user_ids, 1) = 1
     ORDER BY sort_order
  LOOP
    PERFORM public.org_import_apply(r.id, r.user_id);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.org_import_dismiss(p_queue_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT COALESCE(public.has_org_chart_manage(), false) THEN
    RAISE EXCEPTION 'Not authorised to change the org import';
  END IF;
  UPDATE public.org_import_queue
     SET status = 'dismissed', note = p_note,
         resolved_by = auth.uid(), resolved_at = now()
   WHERE id = p_queue_id AND status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only an open row can be dismissed';
  END IF;
END;
$$;

-- Only a dismissal can be taken back here. An applied row made a real
-- membership; undoing that is a roster action, done on the Ministry tab.
CREATE OR REPLACE FUNCTION public.org_import_reopen(p_queue_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT COALESCE(public.has_org_chart_manage(), false) THEN
    RAISE EXCEPTION 'Not authorised to change the org import';
  END IF;
  UPDATE public.org_import_queue
     SET status = 'open', note = NULL, resolved_by = NULL, resolved_at = NULL
   WHERE id = p_queue_id AND status = 'dismissed';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only a dismissed row can be reopened';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.org_match_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_import_apply(uuid, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_import_apply_exact()                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_import_dismiss(uuid, text)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_import_reopen(uuid)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_org_chart_manage()                    TO authenticated;

-- ============================================================
-- Validation (run after applying)
-- ------------------------------------------------------------
--   -- Every chart person box and connector is in the queue (expect 171 / 21 / 1):
--   SELECT source_kind, count(*) FROM public.org_import_queue GROUP BY 1;
--   -- How they matched (dry run said ~48 exact):
--   SELECT match_kind, count(*) FROM public.org_import_queue GROUP BY 1;
--   -- Nothing landed without a ministry:
--   SELECT count(*) FROM public.org_import_queue WHERE staff_ministry_id IS NULL;  -- 0
--
--   -- New ministries, clusters, RCA / Ed for Life under Training, Woven ending:
--   SELECT s.name, s.cluster, p.name AS parent, s.ends_on, s.is_active
--     FROM public.staff_ministries s LEFT JOIN public.staff_ministries p ON p.id = s.parent_id
--    ORDER BY s.cluster NULLS LAST, s.name;
--
--   -- Removing a member keeps them in history (use a throwaway membership):
--   DELETE FROM public.staff_ministry_members WHERE id = '<membership>';
--   SELECT ministry_name, user_name, ended_on FROM public.staff_ministry_membership_history
--    ORDER BY ended_at DESC LIMIT 1;
--
--   -- Nothing has been applied yet — the queue waits for a person:
--   SELECT count(*) FROM public.staff_ministry_members WHERE source = 'chart_import';  -- 0
--
--   -- org.manage renamed; grant it to Sample Person 3 and Sample Person 24 in Users & Roles:
--   SELECT key, display_name FROM public.permissions WHERE key = 'org.manage';
-- ============================================================
