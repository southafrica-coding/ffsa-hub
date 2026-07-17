-- ============================================================
-- FFSA Hub — Migration 126: Staff ministries + membership
-- ============================================================
-- The "Ministry" tab: an admin-managed list of ministries staff belong to,
-- each with one or more Ministry Leaders who run their own roster.
--
-- IMPORTANT: this is a SEPARATE feature from the existing `public.ministries`
-- table, which is owned by the Space Bookings module (color-coded booking
-- categorization, read via getMinistries() in services/bookings.ts). We do
-- NOT touch that table — staff ministries live in their own tables here.
--
-- Staff connect to one or MORE ministries (many-to-many). A membership row is
-- a leader OR a member (member_role); exactly one of a ministry's leaders may
-- be is_point_leader (a display-only "primary" marker — partial unique index
-- enforces the "one"). users.department seeds the initial rows only.
--
-- Per-ministry scope = leads_staff_ministry(id): admin OR an active leader of
-- that ministry. Mirrors has_schools_access — SECURITY DEFINER so it bypasses
-- RLS on the membership table (no recursion from that table's policies).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Tables
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_ministries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.staff_ministry_members (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_ministry_id  uuid NOT NULL REFERENCES public.staff_ministries (id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  member_role        text NOT NULL DEFAULT 'member' CHECK (member_role IN ('member', 'leader')),
  is_point_leader    boolean NOT NULL DEFAULT false,   -- only meaningful when member_role='leader'
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active')),
  added_by           uuid REFERENCES public.users (id),
  approved_by        uuid REFERENCES public.users (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_ministry_id, user_id)
);

-- Exactly one Point Leader per ministry.
CREATE UNIQUE INDEX IF NOT EXISTS one_point_leader_per_staff_ministry
  ON public.staff_ministry_members (staff_ministry_id)
  WHERE is_point_leader;

CREATE INDEX IF NOT EXISTS idx_staff_ministry_members_ministry
  ON public.staff_ministry_members (staff_ministry_id, member_role);
CREATE INDEX IF NOT EXISTS idx_staff_ministry_members_user
  ON public.staff_ministry_members (user_id);

-- ────────────────────────────────────────────────────────────
-- 2. Scope helper — "does the current user lead this ministry?"
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.leads_staff_ministry(target_ministry_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.staff_ministry_members mm
      WHERE mm.staff_ministry_id = target_ministry_id
        AND mm.user_id = auth.uid()
        AND mm.member_role = 'leader'
        AND mm.status = 'active'
    );
$$;

-- ────────────────────────────────────────────────────────────
-- 3. RLS (defense-in-depth; API routes authorize + write via the
--    service-role client, matching the grant-role pattern).
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.staff_ministries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_ministry_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff ministries are readable" ON public.staff_ministries;
CREATE POLICY "Staff ministries are readable"
  ON public.staff_ministries FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admins manage staff ministries" ON public.staff_ministries;
CREATE POLICY "Admins manage staff ministries"
  ON public.staff_ministries FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Staff ministry members are readable" ON public.staff_ministry_members;
CREATE POLICY "Staff ministry members are readable"
  ON public.staff_ministry_members FOR SELECT
  USING (
    public.is_admin()
    OR user_id = auth.uid()
    OR public.leads_staff_ministry(staff_ministry_id)
  );

DROP POLICY IF EXISTS "Ministry leaders manage members" ON public.staff_ministry_members;
CREATE POLICY "Ministry leaders manage members"
  ON public.staff_ministry_members FOR ALL
  USING (public.leads_staff_ministry(staff_ministry_id))
  WITH CHECK (public.leads_staff_ministry(staff_ministry_id));

-- ────────────────────────────────────────────────────────────
-- 4. Seed initial ministries + memberships from users.department.
--    One-time bootstrap; afterwards these tables are the source of
--    truth. (Names kept in sync with users_department_check, 111.)
-- ────────────────────────────────────────────────────────────
INSERT INTO public.staff_ministries (name, slug, sort_order) VALUES
  ('Leadership Team',   'leadership_team',    10),
  ('Prayer & Worship',  'prayer_and_worship', 20),
  ('Media',             'media',              30),
  ('HULC',              'hulk',               40),
  ('Operations',        'operations',         50),
  ('Training',          'training',           60),
  ('Project 54',        'project_54',         70),
  ('Education',         'education',          80),
  ('Woven',             'woven',              90)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.staff_ministry_members (staff_ministry_id, user_id, member_role, status)
SELECT m.id, u.id, 'member', 'active'
FROM public.users u
JOIN public.staff_ministries m ON m.slug = u.department
WHERE u.department IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.staff_ministry_members mm
    WHERE mm.staff_ministry_id = m.id AND mm.user_id = u.id
  );

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   SELECT name, slug FROM public.staff_ministries ORDER BY sort_order;
--   SELECT count(*) FROM public.staff_ministry_members;
--   -- as a leader of ministry X:  SELECT public.leads_staff_ministry('<X>');  -> true
-- ============================================================
