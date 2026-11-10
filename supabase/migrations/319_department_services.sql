-- ============================================================
-- FFSA Hub — Migration 319: Services and who may use them
-- ============================================================
-- Depends on 318 (dept_caller_is_active, dept_can_write_org_structure,
-- staff_ministry_aliases).
--
-- service_owners is the grant the department API reads. Columns:
--   id, service_key, staff_ministry_id, capability, member_role,
--   any_point_leader, open_to_all, admin_href.
-- capability is manage | use | moderate | own.
--   own does not imply manage, use or moderate.
--   manage implies use. moderate implies neither.
-- staff_ministry_id is null only when any_point_leader or open_to_all
-- is true, and only one of those two flags may be true.
-- member_role null on a ministry grant means any active member of that
-- ministry. 'member' means members and leaders. 'leader' means leaders only.
--
-- Evangelism moderation is NOT a service_owners list. 319 extends
-- public.can_moderate_evangelism() (last defined in 311) so active
-- members of active Media and HULC ministries can moderate, and the
-- old is_admin() / evangelism.moderate path is unchanged. There is no
-- capability = 'moderate' seed row.
--
-- open_to_all on a use row means any signed-in active user may use that
-- service. Seeded for gear_hire, evangelism, prayer_room, spaces,
-- vehicles and brand_kit. Communications and contacts have no
-- open_to_all row.
--
-- Contacts use for every ministry's point leader is one row:
-- any_point_leader true, staff_ministry_id null, capability use.
-- user_can_use_service requires mm.is_point_leader on that branch.
--
-- Owning ministries get both own and manage, because own does not imply
-- manage:
--   gear_hire       Prayer & Worship, Operations, Media own and manage,
--                   plus an open_to_all use row
--   communications  Media owns and manages; HULC and Leadership Team use
--   contacts        Media, HULC, Leadership Team own and manage, plus the
--                   any-point-leader use row
--   evangelism      Media and HULC own. Use is an open_to_all row.
--                   Moderation is can_moderate_evangelism, not a grant.
--   prayer_room     Prayer & Worship
--   spaces          Operations
--   vehicles        Operations
--   brand_kit       Media
-- Slugs are the ones already on staff_ministries: prayer_and_worship,
-- operations, media, hulk, leadership_team. A missing slug skips that
-- grant. admin_href is the existing route.
--
-- A caller's folded ministry (318) counts as its home for a grant.
-- Read: any active signed-in user. Write: admin or org.manage.
-- Wrapped in one transaction.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.services (
  service_key  text PRIMARY KEY,
  label        text NOT NULL,
  admin_href   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.services IS
  'Catalog of service keys and their admin routes. Who may use a service is service_owners, including open_to_all use rows.';

CREATE TABLE IF NOT EXISTS public.service_owners (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_key        text NOT NULL REFERENCES public.services (service_key) ON DELETE CASCADE,
  staff_ministry_id  uuid REFERENCES public.staff_ministries (id) ON DELETE CASCADE,
  capability         text NOT NULL CHECK (capability IN ('manage', 'use', 'moderate', 'own')),
  member_role        text CHECK (member_role IS NULL OR member_role IN ('member', 'leader')),
  any_point_leader   boolean NOT NULL DEFAULT false,
  open_to_all        boolean NOT NULL DEFAULT false,
  admin_href         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_owners_scope_ck CHECK (
    (staff_ministry_id IS NOT NULL AND NOT any_point_leader AND NOT open_to_all)
    OR (staff_ministry_id IS NULL AND any_point_leader AND NOT open_to_all)
    OR (staff_ministry_id IS NULL AND NOT any_point_leader AND open_to_all)
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

CREATE UNIQUE INDEX IF NOT EXISTS service_owners_open_to_all_capability_key
  ON public.service_owners (service_key, capability)
  WHERE open_to_all AND staff_ministry_id IS NULL;

CREATE INDEX IF NOT EXISTS service_owners_staff_ministry_id_idx
  ON public.service_owners (staff_ministry_id);

COMMENT ON TABLE public.service_owners IS
  'Who may manage, use or moderate a service, and who owns it. own does not imply manage.';
COMMENT ON COLUMN public.service_owners.any_point_leader IS
  'True only with a null staff_ministry_id, and never together with open_to_all. Contacts use: the caller must be an active point leader (is_point_leader).';
COMMENT ON COLUMN public.service_owners.open_to_all IS
  'True only with a null staff_ministry_id, and never together with any_point_leader. A use row with this flag is open to every signed-in active user.';
COMMENT ON COLUMN public.service_owners.member_role IS
  'Null means any active member of the ministry. member allows members and leaders; leader allows leaders only.';

-- ────────────────────────────────────────────────────────────
-- Use and moderate. Boolean only — no row leakage.
-- manage implies use. own and moderate do not.
-- open_to_all is read here; there is no hard-coded service key.
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
       EXISTS (
         SELECT 1
           FROM public.service_owners so
          WHERE so.service_key = p_service_key
            AND so.open_to_all
            AND so.capability IN ('use', 'manage')
       )
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
                AND NOT so.open_to_all
                AND so.capability IN ('use', 'manage')
                AND (
                  (
                    so.any_point_leader
                    AND mm.member_role = 'leader'
                    AND mm.is_point_leader
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
  'Active account may use the service: an open_to_all use/manage row, an admin when any grant exists, a manage or use grant on their ministry (manage implies use; own does not), or the contacts any_point_leader row when they are an active point leader.';
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
  so.open_to_all,
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

-- Evangelism moderators. Last defined in 311. Same signature, language,
-- volatility and search_path. The original predicate is unchanged; active
-- members of the active Media and HULC ministries are added.
-- There is no service_owners moderate row for this. Nothing in this
-- migration checks capability = 'moderate' for evangelism.
CREATE OR REPLACE FUNCTION public.can_moderate_evangelism()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT public.is_admin()
      OR public.has_permission('evangelism.moderate')
      OR EXISTS (
        SELECT 1
          FROM public.staff_ministry_members mm
          JOIN public.staff_ministries sm ON sm.id = mm.staff_ministry_id
         WHERE mm.user_id = auth.uid()
           AND mm.status = 'active'
           AND sm.is_active
           AND sm.slug IN ('media', 'hulk')
      );
$$;

REVOKE ALL ON FUNCTION public.can_moderate_evangelism() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_moderate_evangelism() TO authenticated, service_role;

COMMENT ON FUNCTION public.can_moderate_evangelism() IS
  '311 rule (admin or evangelism.moderate) plus an active member of active Media or HULC. Not a service_owners row.';

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
  service_key, staff_ministry_id, capability, member_role, any_point_leader, open_to_all, admin_href
)
SELECT s.service_key, m.id, v.capability, v.member_role, v.any_point_leader, v.open_to_all, s.admin_href
  FROM (VALUES
    ('gear_hire',      'prayer_and_worship', 'own',     'member', false, false),
    ('gear_hire',      'prayer_and_worship', 'manage',  'member', false, false),
    ('gear_hire',      'operations',         'own',     'member', false, false),
    ('gear_hire',      'operations',         'manage',  'member', false, false),
    ('gear_hire',      'media',              'own',     'member', false, false),
    ('gear_hire',      'media',              'manage',  'member', false, false),
    ('gear_hire',      NULL,                 'use',     NULL,     false, true),
    ('communications', 'media',              'own',     'member', false, false),
    ('communications', 'media',              'manage',  'member', false, false),
    ('communications', 'hulk',               'use',     'member', false, false),
    ('communications', 'leadership_team',    'use',     'member', false, false),
    ('contacts',       'media',              'own',     'member', false, false),
    ('contacts',       'media',              'manage',  'member', false, false),
    ('contacts',       'hulk',               'own',     'member', false, false),
    ('contacts',       'hulk',               'manage',  'member', false, false),
    ('contacts',       'leadership_team',    'own',     'member', false, false),
    ('contacts',       'leadership_team',    'manage',  'member', false, false),
    ('contacts',       NULL,                 'use',     'leader', true,  false),
    ('evangelism',     'media',              'own',     'member', false, false),
    ('evangelism',     'hulk',               'own',     'member', false, false),
    ('evangelism',     NULL,                 'use',     NULL,     false, true),
    ('prayer_room',    'prayer_and_worship', 'own',     'member', false, false),
    ('prayer_room',    'prayer_and_worship', 'manage',  'member', false, false),
    ('prayer_room',    NULL,                 'use',     NULL,     false, true),
    ('spaces',         'operations',         'own',     'member', false, false),
    ('spaces',         'operations',         'manage',  'member', false, false),
    ('spaces',         NULL,                 'use',     NULL,     false, true),
    ('vehicles',       'operations',         'own',     'member', false, false),
    ('vehicles',       'operations',         'manage',  'member', false, false),
    ('vehicles',       NULL,                 'use',     NULL,     false, true),
    ('brand_kit',      'media',              'own',     'member', false, false),
    ('brand_kit',      'media',              'manage',  'member', false, false),
    ('brand_kit',      NULL,                 'use',     NULL,     false, true)
  ) AS v(service_key, slug, capability, member_role, any_point_leader, open_to_all)
  JOIN public.services s ON s.service_key = v.service_key
  LEFT JOIN public.staff_ministries m ON m.slug = v.slug
 WHERE (v.slug IS NULL OR m.id IS NOT NULL)
   AND NOT EXISTS (
     SELECT 1
       FROM public.service_owners so
      WHERE so.service_key = v.service_key
        AND so.capability = v.capability
        AND so.any_point_leader = v.any_point_leader
        AND so.open_to_all = v.open_to_all
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
    RAISE NOTICE '319 services: skipped grants for missing staff ministries: %', missing;
  END IF;
END $$;

COMMIT;
