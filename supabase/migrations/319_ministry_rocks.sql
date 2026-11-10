-- ============================================================
-- FFSA Hub — Migration 319: Quarterly rocks (EOS L10)
-- ============================================================
-- Depends on 317. Does not create or alter the OKR tables. Those stay
-- the yearly ministry OKRs. public.rocks is the quarterly layer.
--
-- Columns the department API selects, in its names:
--   id, staff_ministry_id, quarter, title, description, owner_user_id,
--   status, due_on, created_by, created_at, updated_at.
-- quarter is text 'YYYY-Q[1-4]', for example 2026-Q4.
-- status is on_track | off_track | done.
-- notes is an extra progress column. The API does not select it.
--
-- Read: active members of that ministry, Leadership Team readers, and
-- admins. Write: the ministry's leaders, and admins. Inactive accounts
-- are denied even when is_admin() would still pass.
--
-- leadership_ministry_rollup (security_invoker) is the Leadership view:
-- every rock, plus current-cycle OKR objectives on a staff ministry.
-- The view's own predicate is leadership-or-admin, and security_invoker
-- still applies rocks and okr_objectives RLS.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.rocks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_ministry_id  uuid NOT NULL REFERENCES public.staff_ministries (id) ON DELETE CASCADE,
  quarter            text NOT NULL CHECK (quarter ~ '^[0-9]{4}-Q[1-4]$'),
  title              text NOT NULL CHECK (btrim(title) <> ''),
  description        text,
  owner_user_id      uuid REFERENCES public.users (id) ON DELETE SET NULL,
  status             text NOT NULL DEFAULT 'on_track'
    CHECK (status IN ('on_track', 'off_track', 'done')),
  due_on             date,
  notes              text,
  created_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rocks_ministry_quarter_idx
  ON public.rocks (staff_ministry_id, quarter);
CREATE INDEX IF NOT EXISTS rocks_owner_user_id_idx
  ON public.rocks (owner_user_id);
CREATE INDEX IF NOT EXISTS rocks_created_by_idx
  ON public.rocks (created_by);

COMMENT ON TABLE public.rocks IS
  'EOS L10 rocks for one staff ministry and one quarter (YYYY-Q[1-4]). Yearly OKRs stay in okr_objectives.';
COMMENT ON COLUMN public.rocks.quarter IS
  'Calendar quarter as text, for example 2026-Q4.';
COMMENT ON COLUMN public.rocks.notes IS
  'Extra progress note. The department API does not read this column.';
COMMENT ON COLUMN public.rocks.status IS
  'on_track, off_track or done.';

DROP TRIGGER IF EXISTS set_updated_at ON public.rocks;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.rocks
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

ALTER TABLE public.rocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rocks FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rocks TO authenticated, service_role;

DROP POLICY IF EXISTS "Ministry readers read rocks" ON public.rocks;
CREATE POLICY "Ministry readers read rocks"
  ON public.rocks FOR SELECT TO authenticated
  USING (public.dept_can_read_rock(staff_ministry_id));

DROP POLICY IF EXISTS "Ministry leaders insert rocks" ON public.rocks;
CREATE POLICY "Ministry leaders insert rocks"
  ON public.rocks FOR INSERT TO authenticated
  WITH CHECK (public.dept_can_write_rock(staff_ministry_id));

DROP POLICY IF EXISTS "Ministry leaders update rocks" ON public.rocks;
CREATE POLICY "Ministry leaders update rocks"
  ON public.rocks FOR UPDATE TO authenticated
  USING (public.dept_can_write_rock(staff_ministry_id))
  WITH CHECK (public.dept_can_write_rock(staff_ministry_id));

DROP POLICY IF EXISTS "Ministry leaders delete rocks" ON public.rocks;
CREATE POLICY "Ministry leaders delete rocks"
  ON public.rocks FOR DELETE TO authenticated
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
  r.due_on,
  r.quarter,
  r.description,
  r.notes,
  r.updated_at
FROM public.staff_ministries m
JOIN public.rocks r ON r.staff_ministry_id = m.id
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
  NULL::text,
  o.description,
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
  'Leadership roll-up: rocks plus current-cycle OKR objectives on a staff ministry. security_invoker. Not a second OKR store.';

REVOKE ALL ON public.leadership_ministry_rollup FROM PUBLIC, anon;
GRANT SELECT ON public.leadership_ministry_rollup TO authenticated, service_role;
