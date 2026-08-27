-- ============================================================
-- FFSA Hub — Migration 192: Department → ministry sync for users
--                            with no signup_type
-- ============================================================
-- Migration 156 added a trigger that auto-joins a user to the ministry whose
-- slug equals their department, but gated it on signup_type = 'staff'. Older
-- and admin-created accounts have signup_type NULL, so 23 real staff members
-- (Nathaly Seidel, Kristine Kilman, Gideon Botha, the Project 54 team, …) were
-- silently skipped and never appeared on their ministry roster.
--
-- signup_type is a poor staff test: of 212 users, 141 are NULL, 68 'staff' and
-- 3 'student' — and no student has ever had a department set. Having a
-- department IS the staff signal, so the gate becomes "not a student".
--
-- Same safety properties as 156: SECURITY DEFINER, ON CONFLICT DO NOTHING, and
-- a no-op when no ministry slug matches, so it can never error the parent
-- insert/update. Existing memberships are never removed.
--
-- no_ministry is included deliberately — the No Ministry roster already held
-- members placed there by the 156 trigger, so excluding it would be
-- inconsistent rather than tidy.
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_staff_department_ministry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.department IS NOT NULL AND NEW.signup_type IS DISTINCT FROM 'student' THEN
    INSERT INTO public.staff_ministry_members (staff_ministry_id, user_id, member_role, status)
    SELECT sm.id, NEW.id, 'member', 'active'
    FROM public.staff_ministries sm
    WHERE sm.slug = NEW.department
    ON CONFLICT (staff_ministry_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger itself is unchanged from 156 (AFTER INSERT OR UPDATE OF department).

-- One-time backfill for everyone the old signup_type='staff' gate skipped.
INSERT INTO public.staff_ministry_members (staff_ministry_id, user_id, member_role, status)
SELECT sm.id, u.id, 'member', 'active'
FROM public.users u
JOIN public.staff_ministries sm ON sm.slug = u.department
WHERE u.department IS NOT NULL
  AND u.signup_type IS DISTINCT FROM 'student'
  AND NOT EXISTS (
    SELECT 1 FROM public.staff_ministry_members m
    WHERE m.staff_ministry_id = sm.id AND m.user_id = u.id
  );

-- ============================================================
-- Validation (run after applying) — expect 0:
--   SELECT count(*) FROM users u JOIN staff_ministries sm ON sm.slug = u.department
--    WHERE u.department IS NOT NULL AND u.signup_type IS DISTINCT FROM 'student'
--      AND NOT EXISTS (SELECT 1 FROM staff_ministry_members m
--                       WHERE m.staff_ministry_id = sm.id AND m.user_id = u.id);
-- ============================================================
