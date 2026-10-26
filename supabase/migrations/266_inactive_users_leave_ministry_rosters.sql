-- ============================================================
-- FFSA Hub — Migration 266: Inactive users leave every ministry roster
-- ============================================================
-- When a HUB account is made inactive (users.is_active true → false) the
-- person is taken off every ministry roster — member AND leader rows, main
-- and part-time, No Ministry included.
--
-- Done as a trigger on users rather than in the API route because accounts
-- are switched off from several places: the admin toggle
-- (/api/admin/set-user-active), the Slack deactivation sync, the student
-- auto-deactivate cron and the user merge (210). A trigger covers all of
-- them, including any added later.
--
-- Knock-on effects of deleting the membership rows, all intended:
--   * staff_ministry_member_subcategories rows cascade away (205).
--   * Point-leader / category point-leader flags go with the row.
--   * Leaving the Leadership Team ministry drops the leadership_team role
--     via sync_leadership_team_role() (131).
--
-- Two existing triggers would otherwise put people straight back:
--   * sync_no_ministry_membership() (206) adds a staff member with zero main
--     memberships to No Ministry — so the instant we delete their last row it
--     would re-add them. Its add side now skips inactive users.
--   * sync_staff_department_ministry() (156/192) joins a user to their
--     department's ministry when department changes. It now skips inactive
--     users too, so editing an inactive profile doesn't re-add them.
--
-- Reactivation (false → true) does NOT restore old rosters — those rows are
-- gone. It re-joins the person to their department's ministry (same rule as
-- 192), and the No Ministry trigger then does its usual job; any part-time
-- ministries or leader appointments have to be re-added from the Ministry tab.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. No Ministry sync: never ADD an inactive user.
--    Identical to 206 apart from the is_active check on the add side.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_no_ministry_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Roles that count as "staff" for the auto-add side. Widen here if needed.
  NO_MINISTRY_STAFF_ROLES constant text[] := ARRAY['staff'];
  nm_id    uuid;
  uid      uuid;
  main_cnt int;
  is_staff boolean;
BEGIN
  -- Secondary circuit-breaker. See migration 206 on why this is not `> 1`.
  IF pg_trigger_depth() > 3 THEN RETURN NULL; END IF;

  SELECT id INTO nm_id FROM public.staff_ministries WHERE slug = 'no_ministry';
  IF nm_id IS NULL THEN RETURN NULL; END IF;

  -- PRIMARY recursion guard.
  IF COALESCE(NEW.staff_ministry_id, OLD.staff_ministry_id) = nm_id THEN
    RETURN NULL;
  END IF;

  uid := COALESCE(NEW.user_id, OLD.user_id);

  SELECT count(*) INTO main_cnt
  FROM public.staff_ministry_members m
  JOIN public.staff_ministries sm ON sm.id = m.staff_ministry_id
  WHERE m.user_id = uid
    AND m.status = 'active'
    AND sm.ministry_type = 'main'
    AND sm.id <> nm_id;

  IF main_cnt > 0 THEN
    -- In a real main ministry → the placeholder is stale. Leader rows go too.
    DELETE FROM public.staff_ministry_members
     WHERE user_id = uid
       AND staff_ministry_id = nm_id;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = uid AND r.name = ANY (NO_MINISTRY_STAFF_ROLES)
    )
    -- Inactive accounts are kept off every roster (266).
    AND EXISTS (
      SELECT 1 FROM public.users u WHERE u.id = uid AND u.is_active
    ) INTO is_staff;

    IF is_staff THEN
      INSERT INTO public.staff_ministry_members
        (staff_ministry_id, user_id, member_role, status)
      VALUES (nm_id, uid, 'member', 'active')
      ON CONFLICT (staff_ministry_id, user_id) DO NOTHING;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 2. Department → ministry sync: skip inactive users.
--    Identical to 192 apart from the is_active check.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_staff_department_ministry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.department IS NOT NULL
     AND NEW.signup_type IS DISTINCT FROM 'student'
     AND NEW.is_active IS NOT FALSE THEN
    INSERT INTO public.staff_ministry_members (staff_ministry_id, user_id, member_role, status)
    SELECT sm.id, NEW.id, 'member', 'active'
    FROM public.staff_ministries sm
    WHERE sm.slug = NEW.department
    ON CONFLICT (staff_ministry_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 3. The new trigger on users.is_active.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_ministry_rosters_on_active_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  nm_id uuid;
BEGIN
  IF NEW.is_active IS FALSE AND OLD.is_active IS DISTINCT FROM FALSE THEN
    -- Made inactive → off every roster.
    DELETE FROM public.staff_ministry_members WHERE user_id = NEW.id;

  ELSIF NEW.is_active IS TRUE AND OLD.is_active IS FALSE THEN
    -- Reactivated → back onto their department's ministry (192's rule).
    IF NEW.department IS NOT NULL AND NEW.signup_type IS DISTINCT FROM 'student' THEN
      INSERT INTO public.staff_ministry_members (staff_ministry_id, user_id, member_role, status)
      SELECT sm.id, NEW.id, 'member', 'active'
      FROM public.staff_ministries sm
      WHERE sm.slug = NEW.department
        AND sm.slug <> 'no_ministry'
      ON CONFLICT (staff_ministry_id, user_id) DO NOTHING;
    END IF;

    -- Staff with no main ministry still belong on No Ministry. The insert
    -- above fires the 206 trigger when it adds a row, but a reactivated
    -- staff member with no department adds nothing, so check here too.
    SELECT id INTO nm_id FROM public.staff_ministries WHERE slug = 'no_ministry';
    IF nm_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.user_roles ur
         JOIN public.roles r ON r.id = ur.role_id
         WHERE ur.user_id = NEW.id AND r.name = 'staff')
       AND NOT EXISTS (
         SELECT 1 FROM public.staff_ministry_members m
         JOIN public.staff_ministries s2 ON s2.id = m.staff_ministry_id
         WHERE m.user_id = NEW.id
           AND m.status = 'active'
           AND s2.ministry_type = 'main'
           AND s2.id <> nm_id) THEN
      INSERT INTO public.staff_ministry_members (staff_ministry_id, user_id, member_role, status)
      VALUES (nm_id, NEW.id, 'member', 'active')
      ON CONFLICT (staff_ministry_id, user_id) DO NOTHING;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS users_active_ministry_rosters ON public.users;
CREATE TRIGGER users_active_ministry_rosters
  AFTER UPDATE OF is_active ON public.users
  FOR EACH ROW
  WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active)
  EXECUTE FUNCTION public.sync_ministry_rosters_on_active_change();

-- ────────────────────────────────────────────────────────────
-- 4. One-time backfill: people who are already inactive.
-- ────────────────────────────────────────────────────────────
DELETE FROM public.staff_ministry_members m
USING public.users u
WHERE u.id = m.user_id
  AND u.is_active = false;

-- ============================================================
-- Validation (expects zero rows):
--   SELECT u.email, sm.name FROM public.staff_ministry_members m
--   JOIN public.users u ON u.id = m.user_id
--   JOIN public.staff_ministries sm ON sm.id = m.staff_ministry_id
--   WHERE u.is_active = false;
-- ============================================================
