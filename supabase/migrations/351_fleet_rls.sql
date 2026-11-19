-- ============================================================
-- FFSA Hub — Migration 351: Fleet — row level security + Realtime
-- ============================================================
-- Requires 350.
--
-- Who can do what (vehicles-module/docs/SPEC.md section 3):
--   • admins and fleet.manage (the Vehicle Coordinator): everything
--   • fleet.view (optional, e.g. leadership): read only
--   • settings and the checklist: admins and fleet.manage (the app lets the
--     co-ordinator sort weekly/monthly and set inspection days; SPEC 3 says
--     "Admin: … plus module settings". Tighten to admins only if Jack prefers.)
--   • drafts and tutorial progress: each person their own
--   • the fleet-files bucket has no storage policies on purpose: it is private
--     and every read and write goes through /api/vehicles/fleet/files, which
--     checks access and uses the service role (as vehicle-inspections, 104/208).
--
-- Realtime: the shared tables join the supabase_realtime publication so every
-- open Fleet page refreshes within about a second of someone else's save.
-- Realtime respects these RLS policies. First use of Realtime in the Hub:
-- check with Jack (HUB-PLAN.md, question 5).
--
-- Grants: Supabase's default privileges give every new public table to anon and
-- authenticated, TRUNCATE included, and TRUNCATE ignores RLS. So, as 307 and 329
-- do, every fleet table is revoked from PUBLIC, anon and authenticated, then
-- authenticated gets back only SELECT / INSERT / UPDATE / DELETE (which RLS
-- checks) and service_role keeps ALL. The helpers run with an empty
-- search_path and can't be executed by anon.
--
-- Safe to re-run (CREATE OR REPLACE, DROP POLICY IF EXISTS, REVOKE before
-- GRANT, publication membership checked), and one transaction.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. Helpers (SECURITY DEFINER, empty search_path, as 329)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.manages_fleet()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_admin() OR public.has_permission('fleet.manage');
$$;

CREATE OR REPLACE FUNCTION public.views_fleet()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.manages_fleet() OR public.has_permission('fleet.view');
$$;

REVOKE ALL ON FUNCTION public.manages_fleet() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.views_fleet() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manages_fleet() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.views_fleet() TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 2. Shared tables: read with views_fleet(), write with manages_fleet()
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'fleet_providers','fleet_vehicle_details','fleet_workshop_visits','fleet_inspections',
    'fleet_odometer_readings','fleet_time_logs','fleet_settings','fleet_files'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.views_fleet())', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.manages_fleet())', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.manages_fleet()) WITH CHECK (public.manages_fleet())', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.manages_fleet())', t || '_delete', t);
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────
-- 3. Per-person tables
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.fleet_inspection_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fleet_inspection_drafts_own ON public.fleet_inspection_drafts;
CREATE POLICY fleet_inspection_drafts_own ON public.fleet_inspection_drafts
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.manages_fleet())
  WITH CHECK (user_id = auth.uid() AND public.manages_fleet());

ALTER TABLE public.fleet_guide_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fleet_guide_progress_own ON public.fleet_guide_progress;
CREATE POLICY fleet_guide_progress_own ON public.fleet_guide_progress
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.views_fleet())
  WITH CHECK (user_id = auth.uid() AND public.views_fleet());

-- ────────────────────────────────────────────────────────────
-- 4. Grants: no anon, no TRUNCATE (see the header)
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'fleet_providers','fleet_vehicle_details','fleet_workshop_visits','fleet_inspections',
    'fleet_inspection_drafts','fleet_odometer_readings','fleet_time_logs','fleet_settings',
    'fleet_guide_progress','fleet_files'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────
-- 5. Realtime (adds only the tables not already in the publication)
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'fleet_vehicle_details','fleet_workshop_visits','fleet_inspections',
    'fleet_odometer_readings','fleet_providers','fleet_settings'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

COMMIT;

-- ────────────────────────────────────────────────────────────
-- Validation
-- ────────────────────────────────────────────────────────────
--   SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename LIKE 'fleet\_%' ORDER BY 1, 3;
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'fleet\_%' AND relkind = 'r';
--   SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename LIKE 'fleet\_%';
--   -- anon has nothing, authenticated has no TRUNCATE / REFERENCES / TRIGGER:
--   SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
--     WHERE table_name LIKE 'fleet\_%' AND grantee IN ('anon','authenticated','PUBLIC') ORDER BY 1, 2, 3;
--   SELECT proname, proconfig FROM pg_proc WHERE proname IN ('manages_fleet','views_fleet');
