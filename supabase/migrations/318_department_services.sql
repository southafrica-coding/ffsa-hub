-- ============================================================
-- FFSA Hub — Migration 318: Services and who may use them
-- ============================================================
-- Depends on 317 (dept_caller_is_active, dept_can_write_org_structure,
-- staff_ministry_aliases).
--
-- service_owners is the ministry grant: service_key, staff_ministry_id,
-- role (owner | access | moderator), admin_href. Unique on
-- (service_key, staff_ministry_id, role).
--
-- A ministry row cannot say "every point leader" or "every signed-in
-- person" without a sentinel ministry, so public.services holds the
-- audience for the service as a whole:
--   roster         — only ministries with owner or access
--   point_leaders  — those ministries, plus each ministry's point leader
--   everyone       — any active signed-in user
-- Moderator is a role on service_owners, not an audience. Evangelism is
-- audience everyone and is moderated by the leaders of Media and HULC.
-- Contacts is audience point_leaders, and is also owned by Media, HULC
-- and Leadership Team so their members can use it without being the
-- point leader.
--
-- owner and access both grant use. The difference is the label the
-- department page shows (who runs it, who else may open it). Moderation
-- is leaders of the moderator ministry only, not every member.
-- A caller's folded ministry (317) counts as its home, so a Donors & Dev
-- member is treated as Finances & Legal for service lookups.
--
-- admin_href lives on services (one place) and is copied onto each
-- service_owners row, which is the column the brief asked for. Routes
-- are the ones in src/config/modules.ts and the bookings hub.
--
-- Read: any active signed-in user. Write: admin or org.manage.
-- Inactive users get nothing. Seeded by slug; a missing ministry skips
-- that one row instead of failing the migration.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.services (
  service_key  text PRIMARY KEY,
  label        text NOT NULL,
  admin_href   text NOT NULL,
  audience     text NOT NULL DEFAULT 'roster'
    CHECK (audience IN ('roster', 'point_leaders', 'everyone')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.services IS
  'One row per Hub service. audience is who may use it beyond the ministry grants in service_owners.';
COMMENT ON COLUMN public.services.audience IS
  'roster = owner/access ministries only; point_leaders = those plus every ministry point leader; everyone = any active signed-in user.';

CREATE TABLE IF NOT EXISTS public.service_owners (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_key        text NOT NULL REFERENCES public.services (service_key) ON DELETE CASCADE,
  staff_ministry_id  uuid NOT NULL REFERENCES public.staff_ministries (id) ON DELETE CASCADE,
  role               text NOT NULL CHECK (role IN ('owner', 'access', 'moderator')),
  admin_href         text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_key, staff_ministry_id, role)
);

CREATE INDEX IF NOT EXISTS service_owners_staff_ministry_id_idx
  ON public.service_owners (staff_ministry_id);

COMMENT ON TABLE public.service_owners IS
  'Which staff ministry owns, may access, or moderates a service. admin_href matches services.admin_href.';
COMMENT ON COLUMN public.service_owners.role IS
  'owner and access both grant use. moderator is the leaders of that ministry (evangelism: Media and HULC).';

-- ────────────────────────────────────────────────────────────
-- Use and moderate. Boolean only — no row leakage.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.user_can_use_service(p_service_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.dept_caller_is_active()
     AND EXISTS (SELECT 1 FROM public.services s WHERE s.service_key = p_service_key)
     AND (
       public.is_admin()
       OR EXISTS (
         SELECT 1 FROM public.services s
          WHERE s.service_key = p_service_key
            AND s.audience = 'everyone'
       )
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
            AND so.role IN ('owner', 'access')
            AND (so.staff_ministry_id = sm.id OR so.staff_ministry_id = al.resolves_to_id)
          WHERE mm.user_id = auth.uid()
            AND mm.status = 'active'
       )
       OR EXISTS (
         SELECT 1
           FROM public.services s
          WHERE s.service_key = p_service_key
            AND s.audience = 'point_leaders'
            AND EXISTS (
              SELECT 1
                FROM public.staff_ministry_members mm
                JOIN public.staff_ministries sm
                  ON sm.id = mm.staff_ministry_id
                 AND sm.is_active
               WHERE mm.user_id = auth.uid()
                 AND mm.status = 'active'
                 AND mm.member_role = 'leader'
                 AND mm.is_point_leader
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
            AND so.role = 'moderator'
            AND (so.staff_ministry_id = sm.id OR so.staff_ministry_id = al.resolves_to_id)
          WHERE mm.user_id = auth.uid()
            AND mm.status = 'active'
            AND mm.member_role = 'leader'
       )
     );
$$;

REVOKE ALL ON FUNCTION public.user_can_use_service(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.user_can_moderate_service(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_use_service(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_can_moderate_service(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.user_can_use_service(text) IS
  'Active account may open this service: admin, audience everyone, member of an owner/access ministry (or of a ministry folded into one), or — for point_leaders — a point leader of any active ministry.';
COMMENT ON FUNCTION public.user_can_moderate_service(text) IS
  'Active admin, or an active leader of a ministry with service_owners.role = moderator (folding counts). Members who are not leaders do not moderate.';

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

-- Asked ministry → its home → that home's grants. Donors & Dev therefore
-- lists Finances & Legal's services and none of its own.
CREATE OR REPLACE VIEW public.ministry_service_access
WITH (security_invoker = true) AS
SELECT
  asked.id AS staff_ministry_id,
  asked.slug AS ministry_slug,
  COALESCE(a.resolves_to_id, asked.id) AS home_ministry_id,
  so.service_key,
  so.role,
  so.admin_href,
  svc.audience,
  svc.label AS service_label
FROM public.staff_ministries asked
LEFT JOIN public.staff_ministry_aliases a ON a.staff_ministry_id = asked.id
JOIN public.service_owners so
  ON so.staff_ministry_id = COALESCE(a.resolves_to_id, asked.id)
JOIN public.services svc ON svc.service_key = so.service_key
WHERE public.dept_caller_is_active();

COMMENT ON VIEW public.ministry_service_access IS
  'Service grants for a ministry after alias resolution. security_invoker. Point-leader and everyone audiences are not rows; use user_can_use_service.';

REVOKE ALL ON public.ministry_service_access FROM PUBLIC, anon;
GRANT SELECT ON public.ministry_service_access TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- Seed. ON CONFLICT DO NOTHING so a later edit of href or audience
-- is not overwritten by a second paste.
-- ────────────────────────────────────────────────────────────

INSERT INTO public.services (service_key, label, admin_href, audience) VALUES
  ('gear_hire',       'Gear hire',       '/bookings/equipment', 'roster'),
  ('communications',  'Communications',  '/communications',     'roster'),
  ('contacts',        'Contacts',        '/contacts',           'point_leaders'),
  ('evangelism',      'Evangelism',      '/evangelism',         'everyone'),
  ('prayer_room',     'Prayer room',     '/prayer-room',        'roster'),
  ('spaces',          'Spaces',          '/bookings/spaces',    'roster'),
  ('vehicles',        'Vehicles',        '/bookings/vehicles',  'roster'),
  ('brand_kit',       'Brand kit',       '/brand-kit',          'roster')
ON CONFLICT (service_key) DO NOTHING;

INSERT INTO public.service_owners (service_key, staff_ministry_id, role, admin_href)
SELECT s.service_key, m.id, v.role, s.admin_href
  FROM (VALUES
    ('gear_hire',      'prayer_and_worship', 'owner'),
    ('gear_hire',      'operations',         'owner'),
    ('gear_hire',      'media',              'owner'),
    ('communications', 'media',              'owner'),
    ('communications', 'hulk',               'access'),
    ('communications', 'leadership_team',    'access'),
    ('contacts',       'media',              'owner'),
    ('contacts',       'hulk',               'owner'),
    ('contacts',       'leadership_team',    'owner'),
    ('evangelism',     'media',              'moderator'),
    ('evangelism',     'hulk',               'moderator'),
    ('prayer_room',    'prayer_and_worship', 'owner'),
    ('spaces',         'operations',         'owner'),
    ('vehicles',       'operations',         'owner'),
    ('brand_kit',      'media',              'owner')
  ) AS v(service_key, slug, role)
  JOIN public.services s ON s.service_key = v.service_key
  JOIN public.staff_ministries m ON m.slug = v.slug
ON CONFLICT (service_key, staff_ministry_id, role) DO NOTHING;

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
    RAISE NOTICE '318 services: skipped owner rows for missing staff ministries: %', missing;
  END IF;
END $$;
