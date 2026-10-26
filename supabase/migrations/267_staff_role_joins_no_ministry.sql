-- ============================================================
-- FFSA Hub — Migration 267: Granting the staff role joins No Ministry
-- ============================================================
-- Migration 206 keeps the "No Ministry" roster automatic, but its trigger
-- lives on staff_ministry_members, so it only runs when someone's rosters
-- change. A person who is given the `staff` role later and has no ministry
-- never triggers it, and ends up on no roster at all (9 active staff when
-- this was written). Ministry leaders' staff search on the Ministry tab is
-- scoped to rosters, so those people were unfindable for them.
--
-- This adds the missing entry point: when a user gains the `staff` role and
-- is active with no active MAIN ministry (the same rule as 206 — part-time
-- does not count), they are added to No Ministry. Losing the staff role
-- deliberately does nothing here, matching 206's add-only staff rule.
--
-- The insert fires 206's trigger, which exits immediately on the
-- no_ministry recursion guard.
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_no_ministry_on_staff_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  nm_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.roles r WHERE r.id = NEW.role_id AND r.name = 'staff'
  ) THEN
    RETURN NULL;
  END IF;

  SELECT id INTO nm_id FROM public.staff_ministries WHERE slug = 'no_ministry';
  IF nm_id IS NULL THEN RETURN NULL; END IF;

  -- Inactive accounts stay off every roster (266).
  IF NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = NEW.user_id AND u.is_active
  ) THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff_ministry_members m
    JOIN public.staff_ministries sm ON sm.id = m.staff_ministry_id
    WHERE m.user_id = NEW.user_id
      AND m.status = 'active'
      AND sm.ministry_type = 'main'
      AND sm.id <> nm_id
  ) THEN
    INSERT INTO public.staff_ministry_members
      (staff_ministry_id, user_id, member_role, status)
    VALUES (nm_id, NEW.user_id, 'member', 'active')
    ON CONFLICT (staff_ministry_id, user_id) DO NOTHING;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS user_roles_staff_no_ministry ON public.user_roles;
CREATE TRIGGER user_roles_staff_no_ministry
  AFTER INSERT OR UPDATE OF role_id, user_id ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.sync_no_ministry_on_staff_role();

-- ────────────────────────────────────────────────────────────
-- One-time backfill: active staff with no active main ministry who are not
-- on No Ministry yet. Same shape as 206's backfill (b), plus the is_active
-- check from 266.
-- ────────────────────────────────────────────────────────────
INSERT INTO public.staff_ministry_members
  (staff_ministry_id, user_id, member_role, status)
SELECT nm.id, u.id, 'member', 'active'
FROM public.users u
CROSS JOIN public.staff_ministries nm
WHERE nm.slug = 'no_ministry'
  AND u.is_active
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = u.id AND r.name = 'staff')
  AND NOT EXISTS (
    SELECT 1 FROM public.staff_ministry_members m
    JOIN public.staff_ministries s2 ON s2.id = m.staff_ministry_id
    WHERE m.user_id = u.id
      AND m.status = 'active'
      AND s2.ministry_type = 'main'
      AND s2.slug <> 'no_ministry')
ON CONFLICT (staff_ministry_id, user_id) DO NOTHING;

-- ============================================================
-- Validation (expects 0):
--   SELECT count(DISTINCT u.id) FROM public.users u
--   JOIN public.user_roles ur ON ur.user_id = u.id
--   JOIN public.roles r ON r.id = ur.role_id AND r.name = 'staff'
--   WHERE u.is_active
--     AND NOT EXISTS (SELECT 1 FROM public.staff_ministry_members m
--                     WHERE m.user_id = u.id);
-- ============================================================
