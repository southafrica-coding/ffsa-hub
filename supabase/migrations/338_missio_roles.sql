-- ============================================================
-- FFSA Hub — Migration 338: Missio roles for coaches and leaders
-- ============================================================
-- Depends on 329 (org_staff_roles, has_org_role, users.contact_id),
-- 331 (house churches) and 337 (missio_coach_assignments).
--
-- Board M10c, first slice. A pastor gives someone with a Hub login a
-- Missio role (granted by the service role, as before):
--   * coach               sees the houses they coach (open rows in
--                         missio_coach_assignments for their contact)
--                         and may change roles and end memberships
--                         there. Pastoral covering, never a step.
--   * house_church_leader sees the houses they lead or co-lead
--                         (open leader / co_leader memberships for
--                         their contact). Read only here.
-- The signed-in user is matched to a contact through users.contact_id.
-- Without that link, or without the grant, the helpers return nothing.
--
-- Pastors keep every existing policy. The new policies are extra
-- permissive policies, so they only ever add the user's own houses.
-- People names stay on org_people_directory (any Missio role, names
-- only), as in 329.
--
-- Idempotent.
-- ============================================================

-- 1. Allow the coach role.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = 'org_staff_roles'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%role%pastor%'
  LOOP
    EXECUTE format('ALTER TABLE public.org_staff_roles DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.org_staff_roles
  ADD CONSTRAINT org_staff_roles_role_check CHECK (role IN (
    'pastor', 'admin', 'house_church_leader', 'team_leader', 'finance', 'coach'
  ));

-- 2. Helpers.
CREATE OR REPLACE FUNCTION public.missio_my_contact_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.contact_id FROM public.users u WHERE u.id = (SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.missio_coached_house_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT a.house_church_id
  FROM public.missio_coach_assignments a
  JOIN public.house_churches hc ON hc.id = a.house_church_id
  JOIN public.organisations o ON o.id = hc.org_id AND o.slug = 'missio'
  WHERE public.has_org_role('missio', ARRAY['coach'])
    AND a.ended_at IS NULL
    AND a.coach_contact_id = public.missio_my_contact_id();
$$;

CREATE OR REPLACE FUNCTION public.missio_led_house_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.house_church_id
  FROM public.house_church_members m
  JOIN public.house_churches hc ON hc.id = m.house_church_id
  JOIN public.organisations o ON o.id = hc.org_id AND o.slug = 'missio'
  WHERE public.has_org_role('missio', ARRAY['house_church_leader'])
    AND m.role IN ('leader', 'co_leader')
    AND m.ended_at IS NULL
    AND m.started_at <= current_date
    AND m.contact_id = public.missio_my_contact_id();
$$;

CREATE OR REPLACE FUNCTION public.missio_my_house_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.missio_coached_house_ids()
  UNION
  SELECT public.missio_led_house_ids();
$$;

REVOKE ALL ON FUNCTION public.missio_my_contact_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.missio_coached_house_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.missio_led_house_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.missio_my_house_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.missio_my_contact_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.missio_coached_house_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.missio_led_house_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.missio_my_house_ids() TO authenticated, service_role;

COMMENT ON FUNCTION public.missio_my_house_ids() IS
  'Houses the signed-in coach or leader may see: coached (coach role + open coach row for their contact) and led (house_church_leader role + open leader/co_leader membership). Empty for everyone else.';

-- 3. Extra read policies for coaches and leaders.
DROP POLICY IF EXISTS "Coaches and leaders can read their houses" ON public.house_churches;
CREATE POLICY "Coaches and leaders can read their houses"
  ON public.house_churches
  FOR SELECT
  TO authenticated
  USING (id IN (SELECT public.missio_my_house_ids()));

DROP POLICY IF EXISTS "Coaches and leaders can read their house members" ON public.house_church_members;
CREATE POLICY "Coaches and leaders can read their house members"
  ON public.house_church_members
  FOR SELECT
  TO authenticated
  USING (house_church_id IN (SELECT public.missio_my_house_ids()));

DROP POLICY IF EXISTS "Coaches and leaders can read their house coach" ON public.missio_coach_assignments;
CREATE POLICY "Coaches and leaders can read their house coach"
  ON public.missio_coach_assignments
  FOR SELECT
  TO authenticated
  USING (house_church_id IN (SELECT public.missio_my_house_ids()));

-- 4. Coaches may change roles and end memberships in houses they coach.
--    The column grants from 331 (role, ended_at) still apply.
DROP POLICY IF EXISTS "Coaches can update members of their houses" ON public.house_church_members;
CREATE POLICY "Coaches can update members of their houses"
  ON public.house_church_members
  FOR UPDATE
  TO authenticated
  USING (house_church_id IN (SELECT public.missio_coached_house_ids()))
  WITH CHECK (house_church_id IN (SELECT public.missio_coached_house_ids()));

-- 5. Several coaches per house (Jack, 19 Nov 2026). 337 allowed one open
--    coach per house; now one open row per house and coach.
DROP INDEX IF EXISTS public.missio_coach_assignments_open_house_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS missio_coach_assignments_open_pair_uidx
  ON public.missio_coach_assignments (house_church_id, coach_contact_id)
  WHERE ended_at IS NULL;

COMMENT ON TABLE public.missio_coach_assignments IS
  'Who coaches a Missio house church. A house can have several coaches; one open row per house and coach. Removing a coach ends the row. Pastoral covering only, never an approval step.';
