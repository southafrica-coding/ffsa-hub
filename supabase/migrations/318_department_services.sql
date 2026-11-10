-- ============================================================
-- FFSA Hub — Migration 318: Services and who may use them
-- ============================================================
-- Depends on 317 (dept_caller_is_active, dept_can_write_org_structure,
-- staff_ministry_aliases).
--
-- service_owners is the grant the department API reads. Columns, exactly:
--   id, service_key, staff_ministry_id, capability, member_role,
--   any_point_leader, admin_href.
-- capability is manage | use | moderate | own.
--   own does not imply manage, use or moderate.
--   manage implies use. moderate implies neither.
-- staff_ministry_id is null only when any_point_leader is true.
-- member_role null means any active member of that ministry, leaders
-- included. 'member' means members and leaders. 'leader' means leaders only.
-- Evangelism moderate is null, so every active member of Media and HULC
-- moderates, the same way a communications grant covers the whole roster.
--
-- Evangelism USE is open to every signed-in active user. There is
-- deliberately no service_owners row for that. The app hardcodes it
-- (canUseService('evangelism') is not read from a grant). Media and HULC
-- still own the service and moderate it.
--
-- Contacts for every ministry leader is one row: any_point_leader true,
-- staff_ministry_id null, capability use, member_role leader. The app
-- treats that flag as "any active ministry leader", not the
-- is_point_leader column.
--
-- Owning ministries get both own and manage, because own does not imply
-- manage:
--   gear_hire       Prayer & Worship, Operations, Media
--   communications  Media owns and manages; HULC and Leadership Team use
--   contacts        Media, HULC, Leadership Team own and manage, plus the
--                   any-point-leader use row
--   evangelism      Media and HULC own and moderate
--   prayer_room     Prayer & Worship
--   spaces          Operations
--   vehicles        Operations
--   brand_kit       Media
-- Slugs are the ones already on staff_ministries: prayer_and_worship,
-- operations, media, hulk, leadership_team. A missing slug skips that
-- grant. admin_href is the existing route.
--
-- A caller's folded ministry (317) counts as its home for a grant.
-- Read: any active signed-in user. Write: admin or org.manage.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.services (
  service_key  text PRIMARY KEY,
  label        text NOT NULL,
  admin_href   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.services IS
  'Catalog of service keys and their admin routes. Grants live in service_owners. Evangelism use is not a grant: the app opens it to every active signed-in user.';

CREATE TABLE IF NOT EXISTS public.service_owners (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_key        text NOT NULL REFERENCES public.services (service_key) ON DELETE CASCADE,
  staff_ministry_id  uuid REFERENCES public.staff_ministries (id) ON DELETE CASCADE,
  capability         text NOT NULL CHECK (capability IN ('manage', 'use', 'moderate', 'own')),
  member_role        text CHECK (member_role IS NULL OR member_role IN ('member', 'leader')),
  any_point_leader   boolean NOT NULL DEFAULT false,
  admin_href         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_owners_point_leader_ministry_ck CHECK (
    (any_point_leader AND staff_ministry_id IS NULL)
    OR (NOT any_point_leader AND staff_ministry_id IS NOT NULL)
  )
);

-- NULL staff_ministry_id does not participate in a plain UNIQUE, so the
-- two cases are separate indexes.
CREATE UNIQUE INDEX IF NOT EXISTS service_owners_ministry_capability_key
  ON public.service_owners (service_key, staff_ministry_id, capability)
  WHERE staff_ministry_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS service_owners_point_leader_capability_key
  ON public.service_owners (service_key, capability)
  WHERE any_point_leader AND staff_ministry_id IS NULL;

CREATE INDEX IF NOT EXISTS service_owners_staff_ministry_id_idx
  ON public.service_owners (staff_ministry_id);

COMMENT ON TABLE public.service_owners IS
  'Who may manage, use or moderate a service, and who owns it. own does not imply manage.';
COMMENT ON COLUMN public.service_owners.any_point_leader IS
  'True only with a null staff_ministry_id. The app treats it as any active ministry leader (member_role = leader), not is_point_leader.';
COMMENT ON COLUMN public.service_owners.member_role IS
  'Null means any active member of the ministry. member allows members and leaders; leader allows leaders only.';

-- ────────────────────────────────────────────────────────────
-- Use and moderate. Boolean only — no row leakage.
-- manage implies use. own and moderate do not.
-- Evangelism use is open to every active account, with no grant row.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.user_can_use_service(p_service_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.dept_caller_is_active()
     AND (
       -- No service_owners row. The app treats evangelism use as open
       -- to every signed-in active user.
       p_service_key = 'evangelism'
       OR (
         EXISTS (
           SELECT 1 FROM public.service_owners so
            WHERE so.service_key = p_service_key
         )
         AND (
           public.is_admin()
           OR EXISTS (
             SELECT 1
               FROM public.staff_ministry_members mm
               JOIN public.staff_ministries sm
                 ON sm.id = mm.staff_ministry_id
                AND sm.is_active
               LEFT JOIN public.staff_ministry_aliases al
                 ON al.staff_ministry_id = sm.id
               JOIN public.service_owners so
                 ON so.service_key = p_service_key
                AND so.capability IN ('use', 'manage')
                AND (
                  (
                    so.any_point_leader
                    AND mm.member_role = 'leader'
                  )
                  OR (
                    NOT so.any_point_leader
                    AND (
                      so.staff_ministry_id = sm.id
                      OR so.staff_ministry_id = al.resolves_to_id
                    )
                    AND (
                      -- Null: any active member of that ministry.
                      so.member_role IS NULL
                      OR so.member_role = mm.member_role
                      OR (so.member_role = 'member' AND mm.member_role = 'leader')
                    )
                  )
                )
              WHERE mm.user_id = auth.uid()
                AND mm.status = 'active'
           )
         )
       )
     );
$$;

CREATE OR REPLACE FUNCTION public.user_can_moderate_service(p_service_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.dept_caller_is_active()
     AND EXISTS (
       SELECT 1 FROM public.service_owners so
        WHERE so.service_key = p_service_key
     )
     AND (
       public.is_admin()
       OR EXISTS (
         SELECT 1
           FROM public.staff_ministry_members mm
           JOIN public.staff_ministries sm
             ON sm.id = mm.staff_ministry_id
            AND sm.is_active
           LEFT JOIN public.staff_ministry_aliases al
             ON al.staff_ministry_id = sm.id
           JOIN public.service_owners so
             ON so.service_key = p_service_key
            AND so.capability = 'moderate'
            AND NOT so.any_point_leader
            AND (
              so.staff_ministry_id = sm.id
              OR so.staff_ministry_id = al.resolves_to_id
            )
            AND (
              -- Null: any active member of that ministry, not leaders only.
              so.member_role IS NULL
              OR so.member_role = mm.member_role
              OR (so.member_role = 'member' AND mm.member_role = 'leader')
            )
          WHERE mm.user_id = auth.uid()
            AND mm.status = 'active'
       )
     );
$$;

REVOKE ALL ON FUNCTION public.user_can_use_service(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.user_can_moderate_service(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_use_service(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_can_moderate_service(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.user_can_use_service(text) IS
  'Active account may use the service. Evangelism is open to every active account and has no grant row for that. Otherwise: admin, or a matching use/manage grant (manage implies use; own and moderate do not). any_point_leader matches any active ministry leader.';
COMMENT ON FUNCTION public.user_can_moderate_service(text) IS
  'Active admin, or a member who meets a moderate grant. own and manage do not moderate.';

-- ────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_owners ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.services FROM PUBLIC, anon;
REVOKE ALL ON public.service_owners FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.services TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_owners TO authenticated, service_role;

DROP POLICY IF EXISTS "Active users read services" ON public.services;
CREATE POLICY "Active users read services"
  ON public.services FOR SELECT TO authenticated
  USING (public.dept_caller_is_active());

DROP POLICY IF EXISTS "Org managers insert services" ON public.services;
CREATE POLICY "Org managers insert services"
  ON public.services FOR INSERT TO authenticated
  WITH CHECK (public.dept_can_write_org_structure());

DROP POLICY IF EXISTS "Org managers update services" ON public.services;
CREATE POLICY "Org managers update services"
  ON public.services FOR UPDATE TO authenticated
  USING (public.dept_can_write_org_structure())
  WITH CHECK (public.dept_can_write_org_structure());

DROP POLICY IF EXISTS "Org managers delete services" ON public.services;
CREATE POLICY "Org managers delete services"
  ON public.services FOR DELETE TO authenticated
  USING (public.dept_can_write_org_structure());

DROP POLICY IF EXISTS "Active users read service owners" ON public.service_owners;
CREATE POLICY "Active users read service owners"
  ON public.service_owners FOR SELECT TO authenticated
  USING (public.dept_caller_is_active());

DROP POLICY IF EXISTS "Org managers insert service owners" ON public.service_owners;
CREATE POLICY "Org managers insert service owners"
  ON public.service_owners FOR INSERT TO authenticated
  WITH CHECK (public.dept_can_write_org_structure());

DROP POLICY IF EXISTS "Org managers update service owners" ON public.service_owners;
CREATE POLICY "Org managers update service owners"
  ON public.service_owners FOR UPDATE TO authenticated
  USING (public.dept_can_write_org_structure())
  WITH CHECK (public.dept_can_write_org_structure());

DROP POLICY IF EXISTS "Org managers delete service owners" ON public.service_owners;
CREATE POLICY "Org managers delete service owners"
  ON public.service_owners FOR DELETE TO authenticated
  USING (public.dept_can_write_org_structure());

-- Asked ministry → its home → that home's grants. A null ministry
-- (any_point_leader) is not a department's grant and is left out.
CREATE OR REPLACE VIEW public.ministry_service_access
WITH (security_invoker = true) AS
SELECT
  asked.id AS staff_ministry_id,
  asked.slug AS ministry_slug,
  COALESCE(a.resolves_to_id, asked.id) AS home_ministry_id,
  so.service_key,
  so.capability,
  so.member_role,
  so.any_point_leader,
  so.admin_href,
  svc.label AS service_label
FROM public.staff_ministries asked
LEFT JOIN public.staff_ministry_aliases a ON a.staff_ministry_id = asked.id
JOIN public.service_owners so
  ON so.staff_ministry_id = COALESCE(a.resolves_to_id, asked.id)
JOIN public.services svc ON svc.service_key = so.service_key
WHERE public.dept_caller_is_active();

COMMENT ON VIEW public.ministry_service_access IS
  'Service grants for a ministry after alias resolution. security_invoker. The contacts any-point-leader row has a null ministry and is not listed here.';

REVOKE ALL ON public.ministry_service_access FROM PUBLIC, anon;
GRANT SELECT ON public.ministry_service_access TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- Seed. A second paste does not add a second grant.
-- ────────────────────────────────────────────────────────────

INSERT INTO public.services (service_key, label, admin_href) VALUES
  ('gear_hire',       'Gear hire',       '/bookings/equipment'),
  ('communications',  'Communications',  '/communications'),
  ('contacts',        'Contacts',        '/contacts'),
  ('evangelism',      'Evangelism',      '/evangelism'),
  ('prayer_room',     'Prayer room',     '/prayer-room'),
  ('spaces',          'Spaces',          '/bookings/spaces'),
  ('vehicles',        'Vehicles',        '/bookings/vehicles'),
  ('brand_kit',       'Brand kit',       '/brand-kit')
ON CONFLICT (service_key) DO NOTHING;

INSERT INTO public.service_owners (
  service_key, staff_ministry_id, capability, member_role, any_point_leader, admin_href
)
SELECT s.service_key, m.id, v.capability, v.member_role, v.any_point_leader, s.admin_href
  FROM (VALUES
    ('gear_hire',      'prayer_and_worship', 'own',     'member', false),
    ('gear_hire',      'prayer_and_worship', 'manage',  'member', false),
    ('gear_hire',      'operations',         'own',     'member', false),
    ('gear_hire',      'operations',         'manage',  'member', false),
    ('gear_hire',      'media',              'own',     'member', false),
    ('gear_hire',      'media',              'manage',  'member', false),
    ('communications', 'media',              'own',     'member', false),
    ('communications', 'media',              'manage',  'member', false),
    ('communications', 'hulk',               'use',     'member', false),
    ('communications', 'leadership_team',    'use',     'member', false),
    ('contacts',       'media',              'own',     'member', false),
    ('contacts',       'media',              'manage',  'member', false),
    ('contacts',       'hulk',               'own',     'member', false),
    ('contacts',       'hulk',               'manage',  'member', false),
    ('contacts',       'leadership_team',    'own',     'member', false),
    ('contacts',       'leadership_team',    'manage',  'member', false),
    ('contacts',       NULL,                 'use',     'leader', true),
    ('evangelism',     'media',              'own',     'member', false),
    ('evangelism',     'media',              'moderate', NULL,     false),
    ('evangelism',     'hulk',               'own',     'member', false),
    ('evangelism',     'hulk',               'moderate', NULL,     false),
    ('prayer_room',    'prayer_and_worship', 'own',     'member', false),
    ('prayer_room',    'prayer_and_worship', 'manage',  'member', false),
    ('spaces',         'operations',         'own',     'member', false),
    ('spaces',         'operations',         'manage',  'member', false),
    ('vehicles',       'operations',         'own',     'member', false),
    ('vehicles',       'operations',         'manage',  'member', false),
    ('brand_kit',      'media',              'own',     'member', false),
    ('brand_kit',      'media',              'manage',  'member', false)
  ) AS v(service_key, slug, capability, member_role, any_point_leader)
  JOIN public.services s ON s.service_key = v.service_key
  LEFT JOIN public.staff_ministries m ON m.slug = v.slug
 WHERE (v.slug IS NULL OR m.id IS NOT NULL)
   AND NOT EXISTS (
     SELECT 1
       FROM public.service_owners so
      WHERE so.service_key = v.service_key
        AND so.capability = v.capability
        AND so.any_point_leader = v.any_point_leader
        AND so.staff_ministry_id IS NOT DISTINCT FROM m.id
   );

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(v.slug, ', ' ORDER BY v.slug) INTO missing
    FROM (VALUES
      ('prayer_and_worship'), ('operations'), ('media'), ('hulk'), ('leadership_team')
    ) AS v(slug)
   WHERE NOT EXISTS (SELECT 1 FROM public.staff_ministries m WHERE m.slug = v.slug);
  IF missing IS NOT NULL THEN
    RAISE NOTICE '318 services: skipped grants for missing staff ministries: %', missing;
  END IF;
END $$;
