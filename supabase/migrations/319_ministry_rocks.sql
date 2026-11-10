-- ============================================================
-- FFSA Hub — Migration 319: Quarterly rocks (EOS L10)
-- ============================================================
-- Depends on 317. Does not create or alter okr_cycles, okr_objectives,
-- okr_key_results, okr_checkins, okr_shepherds or okr_teams. Those stay
-- the yearly ministry OKRs. Rocks are the quarterly layer beside them.
--
-- A rock belongs to one staff ministry and one quarter (year + 1–4).
-- Status is the L10 set on_track | off_track | complete, not okr_status.
-- notes is the progress note.
--
-- Read: active members of that ministry, Leadership Team readers, and
-- admins. Write: the ministry's leaders, and admins. Nobody else.
-- Inactive accounts are denied even when is_admin() would still pass.
--
-- leadership_ministry_rollup (security_invoker) is the Leadership view:
-- every rock, plus current-cycle OKR objectives that belong to a staff
-- ministry. OKR-only teams are not in it (they have no staff ministry).
-- The view's own predicate is leadership-or-admin, and security_invoker
-- still applies rocks and okr_objectives RLS, so a ministry member does
-- not receive the roll-up by selecting the view.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ministry_rocks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_ministry_id  uuid NOT NULL REFERENCES public.staff_ministries (id) ON DELETE CASCADE,
  year               integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  quarter            integer NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  title              text NOT NULL CHECK (btrim(title) <> ''),
  owner_user_id      uuid REFERENCES public.users (id) ON DELETE SET NULL,
  status             text NOT NULL DEFAULT 'on_track'
    CHECK (status IN ('on_track', 'off_track', 'complete')),
  due_date           date,
  notes              text,
  created_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ministry_rocks_ministry_period_idx
  ON public.ministry_rocks (staff_ministry_id, year, quarter);
CREATE INDEX IF NOT EXISTS ministry_rocks_owner_user_id_idx
  ON public.ministry_rocks (owner_user_id);
CREATE INDEX IF NOT EXISTS ministry_rocks_created_by_idx
  ON public.ministry_rocks (created_by);

COMMENT ON TABLE public.ministry_rocks IS
  'EOS L10 quarterly rocks for one staff ministry. Yearly OKRs stay in okr_objectives.';
COMMENT ON COLUMN public.ministry_rocks.notes IS
  'Progress note for the rock.';
COMMENT ON COLUMN public.ministry_rocks.status IS
  'on_track, off_track or complete. Not the OKR status enum.';

DROP TRIGGER IF EXISTS set_updated_at ON public.ministry_rocks;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.ministry_rocks
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE FUNCTION public.dept_can_read_rock(p_ministry_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.dept_caller_is_active()
     AND (
       public.is_admin()
       OR public.dept_is_leadership_reader()
       OR public.dept_is_ministry_member(p_ministry_id, false)
     );
$$;

CREATE OR REPLACE FUNCTION public.dept_can_write_rock(p_ministry_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.dept_caller_is_active()
     AND (
       public.is_admin()
       OR public.dept_is_ministry_leader(p_ministry_id)
     );
$$;

REVOKE ALL ON FUNCTION public.dept_can_read_rock(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dept_can_write_rock(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dept_can_read_rock(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dept_can_write_rock(uuid) TO authenticated, service_role;

ALTER TABLE public.ministry_rocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ministry_rocks FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ministry_rocks TO authenticated, service_role;

DROP POLICY IF EXISTS "Ministry readers read rocks" ON public.ministry_rocks;
CREATE POLICY "Ministry readers read rocks"
  ON public.ministry_rocks FOR SELECT TO authenticated
  USING (public.dept_can_read_rock(staff_ministry_id));

DROP POLICY IF EXISTS "Ministry leaders insert rocks" ON public.ministry_rocks;
CREATE POLICY "Ministry leaders insert rocks"
  ON public.ministry_rocks FOR INSERT TO authenticated
  WITH CHECK (public.dept_can_write_rock(staff_ministry_id));

DROP POLICY IF EXISTS "Ministry leaders update rocks" ON public.ministry_rocks;
CREATE POLICY "Ministry leaders update rocks"
  ON public.ministry_rocks FOR UPDATE TO authenticated
  USING (public.dept_can_write_rock(staff_ministry_id))
  WITH CHECK (public.dept_can_write_rock(staff_ministry_id));

DROP POLICY IF EXISTS "Ministry leaders delete rocks" ON public.ministry_rocks;
CREATE POLICY "Ministry leaders delete rocks"
  ON public.ministry_rocks FOR DELETE TO authenticated
  USING (public.dept_can_write_rock(staff_ministry_id));

CREATE OR REPLACE VIEW public.leadership_ministry_rollup
WITH (security_invoker = true) AS
SELECT
  m.id AS staff_ministry_id,
  m.slug AS ministry_slug,
  m.name AS ministry_name,
  m.ministry_type,
  m.is_active AS ministry_is_active,
  'rock'::text AS source,
  r.id AS source_id,
  r.title,
  r.status,
  NULL::text AS objective_scope,
  r.owner_user_id,
  r.due_date,
  r.year AS period_year,
  r.quarter AS period_quarter,
  r.notes,
  r.updated_at
FROM public.staff_ministries m
JOIN public.ministry_rocks r ON r.staff_ministry_id = m.id
WHERE public.dept_caller_is_active()
  AND (public.is_admin() OR public.dept_is_leadership_reader())
UNION ALL
SELECT
  m.id,
  m.slug,
  m.name,
  m.ministry_type,
  m.is_active,
  'okr_objective'::text,
  o.id,
  o.title,
  'current'::text,
  o.scope::text,
  o.owner_user_id,
  NULL::date,
  EXTRACT(YEAR FROM c.starts_on)::integer,
  NULL::integer,
  o.notes,
  o.updated_at
FROM public.staff_ministries m
JOIN public.okr_objectives o
  ON o.staff_ministry_id = m.id
 AND o.is_archived = false
JOIN public.okr_cycles c
  ON c.id = o.cycle_id
 AND c.is_current
WHERE public.dept_caller_is_active()
  AND (public.is_admin() OR public.dept_is_leadership_reader());

COMMENT ON VIEW public.leadership_ministry_rollup IS
  'Leadership roll-up: ministry rocks plus current-cycle OKR objectives on a staff ministry. security_invoker. Not a second OKR store. OKR-only teams are omitted.';

REVOKE ALL ON public.leadership_ministry_rollup FROM PUBLIC, anon;
GRANT SELECT ON public.leadership_ministry_rollup TO authenticated, service_role;
