-- ============================================================
-- FFSA Hub — Migration 358: Fleet — fixes, kept for good
-- ============================================================
-- Requires 350 and 351.
--
-- "Mark as fixed" (Gideon, 23 Nov 2026): a Fix now point on a vehicle marked fixed
-- from its Condition tab, with the date, who fixed it and what was done. The point's
-- condition (fleet_vehicle_details.condition) goes back to OK, but the next
-- inspection of that point replaces it, so the fix itself is kept here: one row per
-- fix, never changed or deleted, for the vehicle's History and its report.
-- "All history of the vehicles is kept" (Gideon, 23 Nov 2026).
--
-- Add-only: Fleet users can read; Fleet managers can add; nobody can change or
-- delete a row (no update or delete policy, no update or delete grant).
-- Safe to re-run, one transaction; no anon or PUBLIC grants (as 351).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.fleet_fixes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id   uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  item_id      text NOT NULL CHECK (char_length(item_id) BETWEEN 1 AND 60),   -- checklist point id
  point        text NOT NULL CHECK (char_length(point) BETWEEN 1 AND 200),   -- its wording at the time
  fixed_on     date NOT NULL,
  fixed_by     text NOT NULL CHECK (char_length(fixed_by) BETWEEN 1 AND 80),  -- a person or a workshop
  work         text NOT NULL CHECK (char_length(work) BETWEEN 1 AND 300),     -- what was done
  was          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(was) = 'object'),  -- {s, d, n, i}: the Fix now it cleared
  recorded_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fleet_fixes_vehicle ON public.fleet_fixes (vehicle_id, fixed_on DESC);

ALTER TABLE public.fleet_fixes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fleet_fixes_read ON public.fleet_fixes;
CREATE POLICY fleet_fixes_read ON public.fleet_fixes
  FOR SELECT TO authenticated
  USING (public.views_fleet());

DROP POLICY IF EXISTS fleet_fixes_add ON public.fleet_fixes;
CREATE POLICY fleet_fixes_add ON public.fleet_fixes
  FOR INSERT TO authenticated
  WITH CHECK (public.manages_fleet() AND (recorded_by IS NULL OR recorded_by = auth.uid()));

REVOKE ALL ON TABLE public.fleet_fixes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.fleet_fixes TO authenticated;
GRANT ALL ON TABLE public.fleet_fixes TO service_role;

COMMIT;

-- ────────────────────────────────────────────────────────────
-- Validation
-- ────────────────────────────────────────────────────────────
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'fleet_fixes';
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'fleet_fixes';
--   SELECT privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'fleet_fixes' AND grantee = 'authenticated';   -- SELECT, INSERT only
