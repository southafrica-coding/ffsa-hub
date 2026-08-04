-- ============================================================
-- FFSA Hub — Migration 156: Auto-sync staff department → ministry
-- ============================================================
-- The Ministry roster (staff_ministry_members) was populated by a ONE-TIME
-- backfill from users.department when the tab launched (migration 126). Staff
-- who signed up afterwards and picked a department were never added to the
-- matching ministry (e.g. Isabelle Johnson, dept project_54 — not in the
-- Project 54 roster).
--
-- Fix: a trigger that auto-joins a STAFF user to the ministry whose slug equals
-- their department, on signup or whenever their department is set/changed. Plus
-- a one-time backfill for staff who joined since 126. Students (signup_type
-- other than 'staff') are intentionally NOT synced — ministries are staff teams.
--
-- Safe by design: SECURITY DEFINER so it inserts past RLS regardless of who
-- edits the user row; ON CONFLICT DO NOTHING and a no-op when no ministry slug
-- matches, so it can never error the parent insert/update. Does not remove old
-- memberships on a department change (staff can belong to more than one).
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_staff_department_ministry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.department IS NOT NULL AND NEW.signup_type = 'staff' THEN
    INSERT INTO public.staff_ministry_members (staff_ministry_id, user_id, member_role, status)
    SELECT sm.id, NEW.id, 'member', 'active'
    FROM public.staff_ministries sm
    WHERE sm.slug = NEW.department
    ON CONFLICT (staff_ministry_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_staff_department_ministry ON public.users;
CREATE TRIGGER trg_sync_staff_department_ministry
  AFTER INSERT OR UPDATE OF department ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_staff_department_ministry();

-- One-time backfill: staff with a department but no membership in the matching
-- ministry (everyone who slipped through since the 126 seed).
INSERT INTO public.staff_ministry_members (staff_ministry_id, user_id, member_role, status)
SELECT sm.id, u.id, 'member', 'active'
FROM public.users u
JOIN public.staff_ministries sm ON sm.slug = u.department
WHERE u.signup_type = 'staff'
  AND u.department IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.staff_ministry_members m
    WHERE m.staff_ministry_id = sm.id AND m.user_id = u.id
  );

-- ============================================================
-- Validation (run after applying)
-- ------------------------------------------------------------
--   -- Isabelle now in Project 54:
--   SELECT sm.name FROM staff_ministry_members m
--     JOIN staff_ministries sm ON sm.id = m.staff_ministry_id
--    WHERE m.user_id = '1a1199bf-1e17-4f37-b743-0c1238ccf5c3';
--   -- No staff left unsynced (expect 0):
--   SELECT count(*) FROM users u JOIN staff_ministries sm ON sm.slug=u.department
--    WHERE u.signup_type='staff' AND u.department IS NOT NULL
--      AND NOT EXISTS (SELECT 1 FROM staff_ministry_members m
--                       WHERE m.staff_ministry_id=sm.id AND m.user_id=u.id);
-- ============================================================
