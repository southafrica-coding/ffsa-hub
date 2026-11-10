-- ============================================================
-- FFSA Hub — Migration 317: Department homes
-- ============================================================
-- Departments & Services, part 1 of 4 (317–320). 316 is already taken
-- by finance_scope_templates_active_roles (PR #549) and is applied on
-- prod; these numbers start at the next free one. Nothing here replaces
-- has_permission / is_admin / has_role — 313 and 316 own those. New
-- helpers add their own active-account check so an inactive user is
-- denied even on a database where 316 has not been applied yet.
--
-- HULC (slug hulk) and Missio (slug missio_ministry) already exist.
-- This file does not insert them, does not rename them, and does not
-- touch staff_ministry_members for them. HULC already has leaders; they
-- stay exactly as they are. Purpose is left null — it is not in any
-- source we can cite. Cluster is filled only where it is still null,
-- from the org-chart map in migration 250 (hulk = outward,
-- missio_ministry = alongside). Both are set to active main homes.
--
-- Donors & Dev (donors_dev) is folded into Finances & Legal
-- (finances_legal) without deleting the row, its member, or its history:
--   * parent_id points at finances_legal when parent_id is still null
--     (org chart nesting; a parent somebody already chose is kept)
--   * staff_ministry_aliases records the fold. Department pages and
--     service lookups resolve a folded ministry through resolves_to_id.
--     Memberships are NOT moved. One hop only: a folded ministry cannot
--     itself be a fold target.
--
-- Be Free is a booking-palette ministry (public.ministries, slug
-- be-free), not a staff ministry. This adds a part_time staff ministry
-- be_free and links the palette row when that link is still empty.
-- Philip van Staden (users.id ac7d1c5e-4300-422f-9fad-d50c29a15ca6) is
-- recorded as its leader with the same membership columns the Ministry
-- tab uses (member_role = leader, and is_point_leader when the seat is
-- empty). The insert is a no-op when that user id is absent, so a local
-- database without prod users still applies. The existing membership
-- triggers (leadership role, no-ministry sync, org edit log) fire as
-- they do for any roster write. be_free is part_time, so the no-ministry
-- sync does not treat it as a main-ministry home.
--
-- Idempotent: IF NOT EXISTS, DROP POLICY/TRIGGER IF EXISTS, ON CONFLICT
-- DO NOTHING, and updates that skip a row already in the wanted state.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Active-account and membership helpers
-- ────────────────────────────────────────────────────────────
-- search_path '' and schema-qualified names, same as 313/316.
-- SECURITY DEFINER so a policy can see membership without the caller
-- having to pass the members table's own RLS (126 only shows a person
-- their own row, plus what they lead).

CREATE OR REPLACE FUNCTION public.dept_caller_is_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.users u
     WHERE u.id = auth.uid()
       AND u.is_active IS NOT FALSE
  );
$$;

CREATE OR REPLACE FUNCTION public.dept_is_ministry_member(
  p_ministry_id uuid,
  p_leaders_only boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.dept_caller_is_active()
     AND EXISTS (
       SELECT 1
         FROM public.staff_ministry_members mm
        WHERE mm.staff_ministry_id = p_ministry_id
          AND mm.user_id = auth.uid()
          AND mm.status = 'active'
          AND (NOT p_leaders_only OR mm.member_role = 'leader')
     );
$$;

CREATE OR REPLACE FUNCTION public.dept_is_ministry_leader(p_ministry_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.dept_is_ministry_member(p_ministry_id, true);
$$;

-- Leadership Team ministry membership, or the unscoped leadership_team
-- role 131 syncs from it. has_role is not active-aware until 316; the
-- active check above covers both generations.
CREATE OR REPLACE FUNCTION public.dept_is_leadership_reader()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.dept_caller_is_active()
     AND (
       public.has_role('leadership_team')
       OR EXISTS (
         SELECT 1
           FROM public.staff_ministry_members mm
           JOIN public.staff_ministries sm ON sm.id = mm.staff_ministry_id
          WHERE sm.slug = 'leadership_team'
            AND mm.user_id = auth.uid()
            AND mm.status = 'active'
       )
     );
$$;

-- Admins, or an org.manage grant (099). Any scope counts for org.manage,
-- matching has_permission after 316 (only finance.* and
-- schools.templates.manage are unscoped-only). Inactive accounts fail
-- the active check even when is_admin() itself still returns true.
CREATE OR REPLACE FUNCTION public.dept_can_write_org_structure()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.dept_caller_is_active()
     AND (public.is_admin() OR public.has_permission('org.manage'));
$$;

REVOKE ALL ON FUNCTION public.dept_caller_is_active() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dept_is_ministry_member(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dept_is_ministry_leader(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dept_is_leadership_reader() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dept_can_write_org_structure() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.dept_caller_is_active() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dept_is_ministry_member(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dept_is_ministry_leader(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dept_is_leadership_reader() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dept_can_write_org_structure() TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 2. Alias table — a ministry that resolves to another home
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.staff_ministry_aliases (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_ministry_id  uuid NOT NULL UNIQUE REFERENCES public.staff_ministries (id) ON DELETE CASCADE,
  resolves_to_id     uuid NOT NULL REFERENCES public.staff_ministries (id) ON DELETE RESTRICT,
  reason             text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_ministry_aliases_not_self CHECK (staff_ministry_id <> resolves_to_id)
);

CREATE INDEX IF NOT EXISTS staff_ministry_aliases_resolves_to_idx
  ON public.staff_ministry_aliases (resolves_to_id);

COMMENT ON TABLE public.staff_ministry_aliases IS
  'A staff ministry that department pages and service lookups treat as another home. The source row, its members and its history stay. One hop: the target is not itself folded.';

CREATE OR REPLACE FUNCTION public.staff_ministry_aliases_no_chain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.staff_ministry_aliases a
     WHERE a.staff_ministry_id = NEW.resolves_to_id
       AND a.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'Alias target % is itself folded; resolution is one hop', NEW.resolves_to_id
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.staff_ministry_aliases a
     WHERE a.resolves_to_id = NEW.staff_ministry_id
       AND a.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'Ministry % is already a fold target, so it cannot be folded itself', NEW.staff_ministry_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_ministry_aliases_no_chain() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS staff_ministry_aliases_no_chain ON public.staff_ministry_aliases;
CREATE TRIGGER staff_ministry_aliases_no_chain
  BEFORE INSERT OR UPDATE ON public.staff_ministry_aliases
  FOR EACH ROW EXECUTE FUNCTION public.staff_ministry_aliases_no_chain();

CREATE OR REPLACE FUNCTION public.staff_ministry_home_id(p_ministry_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT a.resolves_to_id
       FROM public.staff_ministry_aliases a
      WHERE a.staff_ministry_id = p_ministry_id),
    p_ministry_id
  );
$$;

REVOKE ALL ON FUNCTION public.staff_ministry_home_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_ministry_home_id(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.staff_ministry_home_id(uuid) IS
  'The department home for pages and service lookups. A folded ministry returns its alias target; every other ministry returns itself.';

-- ────────────────────────────────────────────────────────────
-- 3. RLS — any active signed-in user reads; org writers edit
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.staff_ministry_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_ministry_aliases FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_ministry_aliases TO authenticated, service_role;

DROP POLICY IF EXISTS "Active users read ministry aliases" ON public.staff_ministry_aliases;
CREATE POLICY "Active users read ministry aliases"
  ON public.staff_ministry_aliases FOR SELECT
  TO authenticated
  USING (public.dept_caller_is_active());

DROP POLICY IF EXISTS "Org managers insert ministry aliases" ON public.staff_ministry_aliases;
CREATE POLICY "Org managers insert ministry aliases"
  ON public.staff_ministry_aliases FOR INSERT
  TO authenticated
  WITH CHECK (public.dept_can_write_org_structure());

DROP POLICY IF EXISTS "Org managers update ministry aliases" ON public.staff_ministry_aliases;
CREATE POLICY "Org managers update ministry aliases"
  ON public.staff_ministry_aliases FOR UPDATE
  TO authenticated
  USING (public.dept_can_write_org_structure())
  WITH CHECK (public.dept_can_write_org_structure());

DROP POLICY IF EXISTS "Org managers delete ministry aliases" ON public.staff_ministry_aliases;
CREATE POLICY "Org managers delete ministry aliases"
  ON public.staff_ministry_aliases FOR DELETE
  TO authenticated
  USING (public.dept_can_write_org_structure());

-- security_invoker so staff_ministries and alias RLS apply to the caller.
-- The active check is repeated so an inactive account, which can still
-- see staff_ministries under the 126 policy, sees nothing from this view.
CREATE OR REPLACE VIEW public.staff_ministry_resolution
WITH (security_invoker = true) AS
SELECT
  s.id,
  s.slug,
  s.name,
  s.ministry_type,
  s.is_active,
  s.cluster,
  s.purpose,
  s.parent_id,
  COALESCE(a.resolves_to_id, s.id) AS home_id,
  home.slug AS home_slug,
  home.name AS home_name,
  (a.staff_ministry_id IS NOT NULL) AS is_folded
FROM public.staff_ministries s
LEFT JOIN public.staff_ministry_aliases a ON a.staff_ministry_id = s.id
JOIN public.staff_ministries home ON home.id = COALESCE(a.resolves_to_id, s.id)
WHERE public.dept_caller_is_active();

COMMENT ON VIEW public.staff_ministry_resolution IS
  'One row per staff ministry with the home department pages should open. Donors & Dev resolves to Finances & Legal. security_invoker.';

REVOKE ALL ON public.staff_ministry_resolution FROM PUBLIC, anon;
GRANT SELECT ON public.staff_ministry_resolution TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 4. HULC and Missio — homes, not new rows
-- ────────────────────────────────────────────────────────────
-- No INSERT. No rename. No membership write. Purpose stays whatever it
-- already is (null, unless someone has typed one).

UPDATE public.staff_ministries
   SET ministry_type = 'main',
       is_active = true
 WHERE slug IN ('hulk', 'missio_ministry')
   AND (ministry_type IS DISTINCT FROM 'main' OR is_active IS DISTINCT FROM true);

UPDATE public.staff_ministries
   SET cluster = 'outward'
 WHERE slug = 'hulk'
   AND cluster IS NULL;

UPDATE public.staff_ministries
   SET cluster = 'alongside'
 WHERE slug = 'missio_ministry'
   AND cluster IS NULL;

-- ────────────────────────────────────────────────────────────
-- 5. Fold Donors & Dev into Finances & Legal
-- ────────────────────────────────────────────────────────────

UPDATE public.staff_ministries d
   SET parent_id = f.id
  FROM public.staff_ministries f
 WHERE d.slug = 'donors_dev'
   AND f.slug = 'finances_legal'
   AND d.parent_id IS NULL
   AND f.id <> d.id;

INSERT INTO public.staff_ministry_aliases (staff_ministry_id, resolves_to_id, reason)
SELECT d.id, f.id,
       'Donors & Dev is folded into Finances & Legal. The donors_dev row, its membership and its history stay; department pages and service lookups use Finances & Legal.'
  FROM public.staff_ministries d
  JOIN public.staff_ministries f ON f.slug = 'finances_legal'
 WHERE d.slug = 'donors_dev'
   AND d.id <> f.id
ON CONFLICT (staff_ministry_id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 6. Be Free — part-time staff ministry, palette link, leader
-- ────────────────────────────────────────────────────────────

INSERT INTO public.staff_ministries (name, slug, ministry_type, is_active, sort_order)
VALUES ('Be Free', 'be_free', 'part_time', true, 210)
ON CONFLICT (slug) DO UPDATE
  SET ministry_type = 'part_time',
      is_active = true
  WHERE public.staff_ministries.ministry_type IS DISTINCT FROM 'part_time'
     OR public.staff_ministries.is_active IS DISTINCT FROM true;

-- Palette row exists on prod (created in the app, not by a migration).
-- A fresh database gets the slug and name we were given; color stays the
-- column default. An existing row keeps its name and color.
INSERT INTO public.ministries (name, slug)
VALUES ('Be Free', 'be-free')
ON CONFLICT (slug) DO NOTHING;

UPDATE public.ministries m
   SET staff_ministry_id = sm.id,
       updated_at = now()
  FROM public.staff_ministries sm
 WHERE sm.slug = 'be_free'
   AND m.slug = 'be-free'
   AND m.staff_ministry_id IS NULL;

-- Philip van Staden. No-op when the user id is not in this database.
-- is_point_leader only when that seat is empty, so a re-run cannot take
-- the seat from someone else. An existing non-leader row is promoted;
-- an existing leader row is left alone (the WHERE excludes it).
INSERT INTO public.staff_ministry_members (
  staff_ministry_id, user_id, member_role, is_point_leader, status
)
SELECT sm.id,
       'ac7d1c5e-4300-422f-9fad-d50c29a15ca6'::uuid,
       'leader',
       NOT EXISTS (
         SELECT 1
           FROM public.staff_ministry_members seat
          WHERE seat.staff_ministry_id = sm.id
            AND seat.is_point_leader
       ),
       'active'
  FROM public.staff_ministries sm
 WHERE sm.slug = 'be_free'
   AND EXISTS (
     SELECT 1 FROM public.users u
      WHERE u.id = 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6'::uuid
   )
   AND NOT EXISTS (
     SELECT 1
       FROM public.staff_ministry_members mm
      WHERE mm.staff_ministry_id = sm.id
        AND mm.user_id = 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6'::uuid
   );

UPDATE public.staff_ministry_members mm
   SET member_role = 'leader',
       status = 'active',
       is_point_leader = CASE
         WHEN mm.is_point_leader THEN true
         WHEN NOT EXISTS (
           SELECT 1
             FROM public.staff_ministry_members seat
            WHERE seat.staff_ministry_id = mm.staff_ministry_id
              AND seat.is_point_leader
              AND seat.user_id <> mm.user_id
         ) THEN true
         ELSE false
       END
  FROM public.staff_ministries sm
 WHERE sm.slug = 'be_free'
   AND mm.staff_ministry_id = sm.id
   AND mm.user_id = 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6'::uuid
   AND EXISTS (
     SELECT 1 FROM public.users u
      WHERE u.id = 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6'::uuid
   )
   AND (
     mm.member_role IS DISTINCT FROM 'leader'
     OR mm.status IS DISTINCT FROM 'active'
     OR (
       mm.is_point_leader IS NOT TRUE
       AND NOT EXISTS (
         SELECT 1
           FROM public.staff_ministry_members seat
          WHERE seat.staff_ministry_id = mm.staff_ministry_id
            AND seat.is_point_leader
            AND seat.user_id <> mm.user_id
       )
     )
   );

-- Same effect as migration 131's leader backfill and the Ministry API:
-- an active leader holds the unscoped ministry_leader role. NOT EXISTS,
-- not ON CONFLICT — the partial unique index (209) cannot be an inference
-- target. The staff-role trigger (267) ignores any role other than staff.
INSERT INTO public.user_roles (user_id, role_id)
SELECT 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6'::uuid, r.id
  FROM public.roles r
 WHERE r.name = 'ministry_leader'
   AND EXISTS (
     SELECT 1 FROM public.users u
      WHERE u.id = 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6'::uuid
   )
   AND EXISTS (
     SELECT 1
       FROM public.staff_ministry_members mm
       JOIN public.staff_ministries sm ON sm.id = mm.staff_ministry_id
      WHERE sm.slug = 'be_free'
        AND mm.user_id = 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6'::uuid
        AND mm.member_role = 'leader'
        AND mm.status = 'active'
   )
   AND NOT EXISTS (
     SELECT 1
       FROM public.user_roles ur
      WHERE ur.user_id = 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6'::uuid
        AND ur.role_id = r.id
        AND ur.scope_type IS NULL
        AND ur.scope_id IS NULL
   );
