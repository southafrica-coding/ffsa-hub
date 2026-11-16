-- ============================================================
-- FFSA Hub — Migration 182: OKRs schema
-- ============================================================
-- FFSA's OKRs have lived in a Google Sheet: one block per ministry, then
-- "OBJECTIVE n" rows, then "KR n.m" rows carrying a hand-typed Progress word
-- and a Notes cell. That sheet cannot answer "what was this KR's status last
-- month", which is exactly what base-wide KR 2.4 ("all point leaders have
-- ministry OKRs reviewed monthly") needs to evidence.
--
-- This migration models it properly:
--
--   okr_cycles      one row per OKR year (2025, 2026); exactly one is current
--   okr_teams       a group that writes OKRs but is NOT a staff ministry
--   okr_objectives  an objective, owned by a staff ministry OR an okr_team
--   okr_key_results the KRs under it, with a REQUIRED status and an OPTIONAL
--                   numeric metric (start/target/current)
--   okr_checkins    the dated log of progress updates — the reason this is a
--                   database and not a spreadsheet
--
-- SCOPE. Objectives carry a `scope` of 'ministry' or 'individual'. Only the
-- ministry side is being built right now; the individual side (each staff
-- member with their own objectives under their ministry) ships later. The
-- columns, the CHECK constraint and the RLS policies for it are all here from
-- day one, deliberately, so that build needs no second migration and no
-- backfill — only UI and routes.
--
-- WHY okr_teams EXISTS. Several groups that write OKRs are not staff
-- ministries and should not become ones: The Watchmen, Hope Again, Old Age
-- Homes, Evangelism, Brave Love. Making them ministries would give them
-- rosters, departments, nav entries and a leadership role trigger they have no
-- use for. So an objective is owned by exactly one of a staff_ministry or an
-- okr_team, enforced by a CHECK. Team-owned OKRs are readable by everyone, the
-- same as ministry ones; they are editable by leadership and admins only,
-- because a team with no membership table has nobody the database can call its
-- leader. If a team later becomes a real ministry, repoint its objectives.
--
-- AUDIENCES.
--   ministry objectives   readable by every authenticated user;
--                         editable by that ministry's leaders, leadership_team,
--                         and admins.
--   individual objectives readable by the owner, that ministry's leaders,
--                         leadership_team and admins — never by peers;
--                         editable by the same set plus the owner.
--
-- Depends on 126_staff_ministries.sql (staff_ministries, staff_ministry_members,
-- public.leads_staff_ministry) and 131_booking_roles_and_leader_access.sql
-- (the trigger-synced 'leadership_team' role).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. ENUMS
-- ────────────────────────────────────────────────────────────
-- CREATE TYPE has no IF NOT EXISTS and this file gets re-pasted into the SQL
-- editor, so guard both or a second run dies here and leaves the rest unapplied.

DO $$ BEGIN
  CREATE TYPE public.okr_status AS ENUM (
    'not_started', 'in_progress', 'moving_forward', 'stuck', 'complete'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.okr_scope AS ENUM ('ministry', 'individual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ────────────────────────────────────────────────────────────
-- 2. CYCLES
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.okr_cycles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  is_current  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT okr_cycles_dates_ck CHECK (ends_on >= starts_on)
);

-- Exactly one current cycle, same idiom as one_point_leader_per_staff_ministry.
CREATE UNIQUE INDEX IF NOT EXISTS one_current_okr_cycle
  ON public.okr_cycles ((true)) WHERE is_current;

INSERT INTO public.okr_cycles (name, slug, starts_on, ends_on, is_current) VALUES
  ('2025', '2025', '2025-01-01', '2025-12-31', false),
  ('2026', '2026', '2026-01-01', '2026-12-31', true)
ON CONFLICT (slug) DO NOTHING;

-- Promoting a cycle has to demote the incumbent in the same statement — the
-- partial unique index rejects two, and there is no transaction spanning two
-- PostgREST calls.
CREATE OR REPLACE FUNCTION public.set_current_okr_cycle(target_cycle_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_admin() OR public.has_role('leadership_team')) THEN
    RAISE EXCEPTION 'Not authorised to change the current OKR cycle';
  END IF;

  UPDATE public.okr_cycles SET is_current = false
   WHERE is_current AND id <> target_cycle_id;

  UPDATE public.okr_cycles SET is_current = true WHERE id = target_cycle_id;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 3. OKR-ONLY TEAMS
-- ────────────────────────────────────────────────────────────
-- Deliberately thin: a name and a slug. No members, no leaders, no department
-- link. The moment one of these needs a roster it should become a staff
-- ministry instead, and its objectives repointed.

CREATE TABLE IF NOT EXISTS public.okr_teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.okr_teams (name, slug, sort_order) VALUES
  ('The Watchmen',  'the_watchmen',  10),
  ('Brave Love',    'brave_love',    20),
  ('Hope Again',    'hope_again',    30),
  ('Old Age Homes', 'old_age_homes', 40),
  ('Evangelism',    'evangelism',    50)
ON CONFLICT (slug) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 4. OBJECTIVES
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.okr_objectives (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id          uuid NOT NULL REFERENCES public.okr_cycles (id) ON DELETE CASCADE,
  scope             public.okr_scope NOT NULL DEFAULT 'ministry',
  -- Exactly one owner: a staff ministry or an OKR-only team (see the XOR
  -- constraint below). For individual objectives it is always the ministry —
  -- "your ministry leader can see it" is the visibility rule, and the link is
  -- what makes that rule expressible.
  staff_ministry_id uuid REFERENCES public.staff_ministries (id) ON DELETE CASCADE,
  okr_team_id       uuid REFERENCES public.okr_teams (id) ON DELETE CASCADE,
  subcategory_id    uuid REFERENCES public.staff_ministry_subcategories (id) ON DELETE SET NULL,
  owner_user_id     uuid REFERENCES public.users (id) ON DELETE CASCADE,
  position          integer NOT NULL DEFAULT 0,
  title             text NOT NULL,
  description       text,
  -- Free text on purpose: the sheet's values are prose ("Q2", "Sample Person 246 is our
  -- man."). Structure them later if the team asks for it.
  owner_note        text,
  timeline          text,
  is_archived       boolean NOT NULL DEFAULT false,
  created_by        uuid REFERENCES public.users (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT okr_objectives_scope_owner_ck CHECK (
    (scope = 'ministry'   AND owner_user_id IS NULL) OR
    (scope = 'individual' AND owner_user_id IS NOT NULL)
  ),
  -- Exactly one owning group, never both, never neither.
  CONSTRAINT okr_objectives_owner_group_ck CHECK (
    (staff_ministry_id IS NOT NULL AND okr_team_id IS NULL) OR
    (staff_ministry_id IS NULL     AND okr_team_id IS NOT NULL)
  ),
  -- An individual's OKRs hang off their ministry; an OKR-only team has no
  -- members, so there is nobody for an individual objective to belong to.
  CONSTRAINT okr_objectives_individual_needs_ministry_ck CHECK (
    scope = 'ministry' OR staff_ministry_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_okr_objectives_cycle_ministry
  ON public.okr_objectives (cycle_id, staff_ministry_id, position);
CREATE INDEX IF NOT EXISTS idx_okr_objectives_owner
  ON public.okr_objectives (owner_user_id, cycle_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_okr_objectives_scope
  ON public.okr_objectives (scope, cycle_id);
CREATE INDEX IF NOT EXISTS idx_okr_objectives_cycle_team
  ON public.okr_objectives (cycle_id, okr_team_id, position) WHERE okr_team_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at ON public.okr_objectives;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.okr_objectives
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ────────────────────────────────────────────────────────────
-- 5. KEY RESULTS
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.okr_key_results (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id    uuid NOT NULL REFERENCES public.okr_objectives (id) ON DELETE CASCADE,
  position        integer NOT NULL DEFAULT 0,
  label           text,          -- the raw "KR 3.2" as it read in the sheet
  description     text NOT NULL,
  notes           text,
  timeline        text,
  owner_note      text,

  -- Optional numeric metric. All-or-nothing.
  metric_unit     text,
  metric_start    numeric,
  metric_target   numeric,

  -- Denormalised current state, maintained ONLY by the check-in trigger below.
  current_status  public.okr_status NOT NULL DEFAULT 'not_started',
  current_value   numeric,
  last_checkin_at timestamptz,
  last_checkin_id uuid,

  created_by      uuid REFERENCES public.users (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- "No ratio, no bar" enforced in the database: a metric only counts as a
  -- metric when start AND target both exist and differ. That also makes the
  -- (current - start) / (target - start) division impossible to blow up.
  CONSTRAINT okr_kr_metric_ck CHECK (
    (metric_start IS NULL AND metric_target IS NULL)
    OR (metric_start IS NOT NULL AND metric_target IS NOT NULL
        AND metric_target <> metric_start)
  )
);

CREATE INDEX IF NOT EXISTS idx_okr_key_results_objective
  ON public.okr_key_results (objective_id, position);
CREATE INDEX IF NOT EXISTS idx_okr_key_results_status
  ON public.okr_key_results (current_status);

DROP TRIGGER IF EXISTS set_updated_at ON public.okr_key_results;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.okr_key_results
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ────────────────────────────────────────────────────────────
-- 6. CHECK-INS
-- ────────────────────────────────────────────────────────────
-- checkin_on is a date because people back-date an update to the week it
-- covers; created_at breaks ties between two check-ins on the same date.

CREATE TABLE IF NOT EXISTS public.okr_checkins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_result_id uuid NOT NULL REFERENCES public.okr_key_results (id) ON DELETE CASCADE,
  checkin_on    date NOT NULL DEFAULT CURRENT_DATE,
  status        public.okr_status NOT NULL,
  value         numeric,
  comment       text,
  author_id     uuid NOT NULL REFERENCES public.users (id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_okr_checkins_kr
  ON public.okr_checkins (key_result_id, checkin_on DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_okr_checkins_author
  ON public.okr_checkins (author_id, created_at DESC);

ALTER TABLE public.okr_key_results
  DROP CONSTRAINT IF EXISTS okr_key_results_last_checkin_fk;
ALTER TABLE public.okr_key_results
  ADD CONSTRAINT okr_key_results_last_checkin_fk
  FOREIGN KEY (last_checkin_id) REFERENCES public.okr_checkins (id) ON DELETE SET NULL;

-- Current KR state is derived from the latest check-in, but stored, because the
-- OKR wall renders ~500 key results at once and PostgREST cannot express a
-- DISTINCT ON latest-per-parent. Doing it in a TRIGGER rather than in the API
-- route matters: three write paths must agree — the route, the one-off sheet
-- import (service-role, bypasses app code entirely), and manual corrections in
-- the SQL editor. Only the database sees all three.
CREATE OR REPLACE FUNCTION public.refresh_okr_key_result_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  kr_id uuid;
BEGIN
  kr_id := COALESCE(NEW.key_result_id, OLD.key_result_id);

  UPDATE public.okr_key_results kr
     SET current_status  = latest.status,
         current_value   = latest.value,
         last_checkin_at = latest.created_at,
         last_checkin_id = latest.id,
         updated_at      = now()
    FROM (
      SELECT c.id, c.status, c.value, c.created_at
        FROM public.okr_checkins c
       WHERE c.key_result_id = kr_id
       ORDER BY c.checkin_on DESC, c.created_at DESC
       LIMIT 1
    ) latest
   WHERE kr.id = kr_id;

  -- UPDATE ... FROM (subquery) touches ZERO rows when the subquery is empty,
  -- so deleting a key result's last check-in would otherwise leave the stale
  -- status sitting there. Reset it explicitly.
  IF NOT FOUND THEN
    UPDATE public.okr_key_results
       SET current_status  = 'not_started',
           current_value   = NULL,
           last_checkin_at = NULL,
           last_checkin_id = NULL,
           updated_at      = now()
     WHERE id = kr_id;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS okr_checkins_refresh_kr ON public.okr_checkins;
CREATE TRIGGER okr_checkins_refresh_kr
  AFTER INSERT OR UPDATE OR DELETE ON public.okr_checkins
  FOR EACH ROW EXECUTE FUNCTION public.refresh_okr_key_result_state();

-- ────────────────────────────────────────────────────────────
-- 7. VISIBILITY / EDIT HELPERS
-- ────────────────────────────────────────────────────────────
-- SECURITY DEFINER is not optional here: these read okr_objectives and are
-- called from the okr_key_results and okr_checkins policies, which would
-- otherwise recurse into the objectives SELECT policy.

CREATE OR REPLACE FUNCTION public.can_view_okr_objective(target_objective_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.okr_objectives o
     WHERE o.id = target_objective_id
       AND auth.uid() IS NOT NULL
       AND (
            o.scope = 'ministry'
         OR o.owner_user_id = auth.uid()
         OR public.is_admin()
         OR public.has_role('leadership_team')
         OR EXISTS (
              SELECT 1 FROM public.staff_ministry_members mm
               WHERE mm.staff_ministry_id = o.staff_ministry_id
                 AND mm.user_id     = auth.uid()
                 AND mm.member_role = 'leader'
                 AND mm.status      = 'active'
            )
       )
  );
$$;

-- No separate is_point_leader branch: leads_staff_ministry already matches any
-- active leader, and a point leader is one.
--
-- For a TEAM-owned objective staff_ministry_id is NULL, and
-- leads_staff_ministry(NULL) collapses to is_admin() — its EXISTS can never
-- match a NULL. So team OKRs come out editable by admins and leadership only,
-- which is the intended rule, without a separate branch.
CREATE OR REPLACE FUNCTION public.can_edit_okr_objective(target_objective_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.okr_objectives o
     WHERE o.id = target_objective_id
       AND (
            public.is_admin()
         OR public.has_role('leadership_team')
         OR public.leads_staff_ministry(o.staff_ministry_id)
         OR (o.scope = 'individual' AND o.owner_user_id = auth.uid())
       )
  );
$$;

-- INSERT-time variant: there is no row yet to look up.
CREATE OR REPLACE FUNCTION public.can_create_okr(
  p_scope         public.okr_scope,
  p_ministry_id   uuid,
  p_owner_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
      OR public.has_role('leadership_team')
      OR public.leads_staff_ministry(p_ministry_id)
      OR (p_scope = 'individual' AND p_owner_user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.can_view_okr_key_result(target_kr_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.okr_key_results kr
     WHERE kr.id = target_kr_id
       AND public.can_view_okr_objective(kr.objective_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_edit_okr_key_result(target_kr_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.okr_key_results kr
     WHERE kr.id = target_kr_id
       AND public.can_edit_okr_objective(kr.objective_id)
  );
$$;

GRANT EXECUTE ON FUNCTION public.set_current_okr_cycle(uuid)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_okr_objective(uuid)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_okr_objective(uuid)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_create_okr(public.okr_scope, uuid, uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_okr_key_result(uuid)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_okr_key_result(uuid)                   TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 8. RLS
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.okr_cycles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.okr_teams       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.okr_objectives  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.okr_key_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.okr_checkins    ENABLE ROW LEVEL SECURITY;

-- Cycles ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "OKR cycles are readable" ON public.okr_cycles;
CREATE POLICY "OKR cycles are readable"
  ON public.okr_cycles FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Leadership manages OKR cycles" ON public.okr_cycles;
CREATE POLICY "Leadership manages OKR cycles"
  ON public.okr_cycles FOR ALL TO authenticated
  USING (public.is_admin() OR public.has_role('leadership_team'))
  WITH CHECK (public.is_admin() OR public.has_role('leadership_team'));

-- OKR-only teams ─────────────────────────────────────────────
DROP POLICY IF EXISTS "OKR teams are readable" ON public.okr_teams;
CREATE POLICY "OKR teams are readable"
  ON public.okr_teams FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Leadership manages OKR teams" ON public.okr_teams;
CREATE POLICY "Leadership manages OKR teams"
  ON public.okr_teams FOR ALL TO authenticated
  USING (public.is_admin() OR public.has_role('leadership_team'))
  WITH CHECK (public.is_admin() OR public.has_role('leadership_team'));

-- Objectives ─────────────────────────────────────────────────
-- Written inline rather than calling can_view_okr_objective(id): the columns
-- are right here, and a helper that re-reads this table from inside this
-- table's own policy is pure overhead. The helper exists for the child tables.
DROP POLICY IF EXISTS "OKR objectives are readable by audience" ON public.okr_objectives;
CREATE POLICY "OKR objectives are readable by audience"
  ON public.okr_objectives FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
         scope = 'ministry'
      OR owner_user_id = auth.uid()
      OR public.is_admin()
      OR public.has_role('leadership_team')
      OR public.leads_staff_ministry(staff_ministry_id)
    )
  );

DROP POLICY IF EXISTS "OKR objectives insertable by owners and leaders" ON public.okr_objectives;
CREATE POLICY "OKR objectives insertable by owners and leaders"
  ON public.okr_objectives FOR INSERT TO authenticated
  WITH CHECK (public.can_create_okr(scope, staff_ministry_id, owner_user_id));

-- WITH CHECK runs against the NEW values, so a ministry leader cannot re-point
-- an objective at a ministry they do not lead.
DROP POLICY IF EXISTS "OKR objectives updatable by owners and leaders" ON public.okr_objectives;
CREATE POLICY "OKR objectives updatable by owners and leaders"
  ON public.okr_objectives FOR UPDATE TO authenticated
  USING (public.can_edit_okr_objective(id))
  WITH CHECK (public.can_create_okr(scope, staff_ministry_id, owner_user_id));

DROP POLICY IF EXISTS "OKR objectives deletable by owners and leaders" ON public.okr_objectives;
CREATE POLICY "OKR objectives deletable by owners and leaders"
  ON public.okr_objectives FOR DELETE TO authenticated
  USING (public.can_edit_okr_objective(id));

-- Key results ────────────────────────────────────────────────
DROP POLICY IF EXISTS "OKR key results are readable by audience" ON public.okr_key_results;
CREATE POLICY "OKR key results are readable by audience"
  ON public.okr_key_results FOR SELECT TO authenticated
  USING (public.can_view_okr_objective(objective_id));

DROP POLICY IF EXISTS "OKR key results writable by owners and leaders" ON public.okr_key_results;
CREATE POLICY "OKR key results writable by owners and leaders"
  ON public.okr_key_results FOR ALL TO authenticated
  USING (public.can_edit_okr_objective(objective_id))
  WITH CHECK (public.can_edit_okr_objective(objective_id));

-- Check-ins ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "OKR check-ins are readable by audience" ON public.okr_checkins;
CREATE POLICY "OKR check-ins are readable by audience"
  ON public.okr_checkins FOR SELECT TO authenticated
  USING (public.can_view_okr_key_result(key_result_id));

DROP POLICY IF EXISTS "OKR check-ins insertable by editors" ON public.okr_checkins;
CREATE POLICY "OKR check-ins insertable by editors"
  ON public.okr_checkins FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND public.can_edit_okr_key_result(key_result_id));

-- A check-in is a log entry, not a field. An author may correct their own; only
-- leadership and admins may touch someone else's. No blanket editor rewrite.
DROP POLICY IF EXISTS "OKR check-ins editable by author or leadership" ON public.okr_checkins;
CREATE POLICY "OKR check-ins editable by author or leadership"
  ON public.okr_checkins FOR UPDATE TO authenticated
  USING (author_id = auth.uid() OR public.is_admin() OR public.has_role('leadership_team'))
  WITH CHECK (author_id = auth.uid() OR public.is_admin() OR public.has_role('leadership_team'));

DROP POLICY IF EXISTS "OKR check-ins deletable by author or leadership" ON public.okr_checkins;
CREATE POLICY "OKR check-ins deletable by author or leadership"
  ON public.okr_checkins FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR public.is_admin() OR public.has_role('leadership_team'));

-- ============================================================
-- Validation (run after applying)
-- ------------------------------------------------------------
--   -- Cycles seeded, exactly one current:
--   SELECT name, slug, starts_on, ends_on, is_current
--     FROM public.okr_cycles ORDER BY starts_on;
--   -- A second current must be rejected by one_current_okr_cycle:
--   UPDATE public.okr_cycles SET is_current = true WHERE slug = '2025';
--     -- expect: duplicate key value violates unique constraint
--
--   -- Tables empty before the sheet import:
--   SELECT count(*) FROM public.okr_objectives;   -- 0
--
--   -- As a PLAIN STAFF user:
--   SELECT count(*) FROM public.okr_objectives WHERE scope = 'ministry';
--     -- expect: every ministry objective
--   SELECT count(*) FROM public.okr_objectives WHERE scope = 'individual';
--     -- expect: 0 (or only rows they own) — never a peer's
--
--   -- As a LEADER of ministry X:
--   SELECT public.can_edit_okr_objective('<objective in X>');   -- true
--   SELECT public.can_edit_okr_objective('<objective in Y>');   -- false
--   SELECT public.can_view_okr_objective('<ministry objective in Y>'); -- true
--
--   -- Trigger keeps current_status in step:
--   INSERT INTO public.okr_checkins (key_result_id, status, author_id)
--     VALUES ('<kr>', 'in_progress', auth.uid());
--   SELECT current_status, current_value, last_checkin_at
--     FROM public.okr_key_results WHERE id = '<kr>';
--     -- expect: in_progress, NULL, now()
--
--   -- ...and resets when the last check-in is removed (the IF NOT FOUND path):
--   DELETE FROM public.okr_checkins WHERE key_result_id = '<kr>';
--   SELECT current_status, last_checkin_at
--     FROM public.okr_key_results WHERE id = '<kr>';
--     -- expect: not_started, NULL
--
--   -- OKR-only teams seeded:
--   SELECT name, slug FROM public.okr_teams ORDER BY sort_order;
--     -- expect: The Watchmen, Brave Love, Hope Again, Old Age Homes, Evangelism
--   -- An objective must have exactly one owning group:
--   INSERT INTO public.okr_objectives (cycle_id, title) VALUES ('<cycle>', 'orphan');
--     -- expect: violates check constraint "okr_objectives_owner_group_ck"
--   -- ...and an individual objective cannot hang off a team:
--   INSERT INTO public.okr_objectives (cycle_id, scope, okr_team_id, owner_user_id, title)
--     VALUES ('<cycle>', 'individual', '<team>', auth.uid(), 'no');
--     -- expect: violates "okr_objectives_individual_needs_ministry_ck"
--
--   -- "No ratio, no bar" is enforced here, not just in the UI:
--   INSERT INTO public.okr_key_results (objective_id, description, metric_start)
--     VALUES ('<objective>', 'half a metric', 0);
--     -- expect: violates check constraint "okr_kr_metric_ck"
-- ============================================================
