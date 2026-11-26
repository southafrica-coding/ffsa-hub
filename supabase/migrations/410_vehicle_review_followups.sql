-- ============================================================
-- FFSA Hub — Migration 410: follow-ups from Jack's reviews of #712 and #717
-- ============================================================
-- Fleet and vehicles migrations use the 400s from here on (Jack, 24 Nov 2026); 400–403
-- are taken elsewhere. Requires 350, 358, 364.
--
-- 1. Nobody DECIDES their own early return (#712 review). 364's guard stopped someone
--    approving their own; this also stops them declining it. The person who booked and
--    the person who asked are refused either way, managers included.
-- 2. The guard functions are trigger functions: nobody needs EXECUTE on them. 364 left
--    vehicle_bookings_guard_return() executable by PUBLIC (#712 review).
-- 3. Mark as fixed in one transaction (#717 review): fleet_mark_fixed() writes the fix
--    to fleet_fixes and the point to fleet_vehicle_details together, so a half-saved fix
--    can't be left behind. SECURITY INVOKER: the caller's RLS applies to both writes
--    (358's add policy, 350's details policies), and recorded_by is always the caller.
--
-- Safe to re-run, one transaction; no anon or PUBLIC grants.
-- ============================================================

BEGIN;

-- ── 1 + 2. The return guard (364), with "decide" in place of "approve" ──
CREATE OR REPLACE FUNCTION public.vehicle_bookings_guard_return()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NEW.early_return_status IN ('approved', 'declined')
     AND NEW.early_return_status IS DISTINCT FROM OLD.early_return_status
     AND auth.uid() IN (NEW.requested_by, NEW.early_return_requested_by) THEN
    RAISE EXCEPTION 'You can''t decide your own early return' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NULL
     OR public.is_admin()
     OR public.has_permission('vehicles.approve')
     OR public.has_permission('vehicles.manage') THEN
    RETURN NEW;
  END IF;
  IF NEW.returned_at IS DISTINCT FROM OLD.returned_at
     OR NEW.returned_by IS DISTINCT FROM OLD.returned_by THEN
    RAISE EXCEPTION 'Only the Vehicle Coordinator can mark a vehicle returned' USING ERRCODE = '42501';
  END IF;
  IF NEW.early_return_status IS DISTINCT FROM OLD.early_return_status
     AND NEW.early_return_status IS DISTINCT FROM 'requested' THEN
    RAISE EXCEPTION 'Only the Vehicle Coordinator can decide an early return' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.vehicle_bookings_guard_return() FROM PUBLIC, anon, authenticated;

-- ── 3. Mark as fixed, all or nothing ──────────────────────────
CREATE OR REPLACE FUNCTION public.fleet_mark_fixed(
  p_vehicle_id uuid,
  p_item_id    text,
  p_point      text,
  p_fixed_on   date,
  p_fixed_by   text,
  p_work       text,
  p_was        jsonb,
  p_entry      jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_fix uuid;
  v_rows int;
BEGIN
  INSERT INTO public.fleet_fixes (vehicle_id, item_id, point, fixed_on, fixed_by, work, was, recorded_by)
  VALUES (p_vehicle_id, p_item_id, p_point, p_fixed_on, p_fixed_by, p_work, coalesce(p_was, '{}'::jsonb), auth.uid())
  RETURNING id INTO v_fix;

  UPDATE public.fleet_vehicle_details
     SET condition  = coalesce(condition, '{}'::jsonb) || jsonb_build_object(p_item_id, p_entry),
         updated_by = auth.uid()
   WHERE vehicle_id = p_vehicle_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  -- No row updated (unknown vehicle, or RLS hid it): undo the fix too.
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'That vehicle''s condition couldn''t be saved' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_fix;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fleet_mark_fixed(uuid, text, text, date, text, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fleet_mark_fixed(uuid, text, text, date, text, text, jsonb, jsonb) TO authenticated, service_role;

COMMIT;
