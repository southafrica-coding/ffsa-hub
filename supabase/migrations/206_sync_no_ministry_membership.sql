-- ============================================================
-- FFSA Hub — Migration 206: Keep the "No Ministry" roster automatic
-- ============================================================
-- "No Ministry" is the placeholder ministry for staff who aren't on a ministry.
-- It is an ordinary staff_ministries row (slug 'no_ministry') that was created
-- through the admin UI, never by a migration. Nothing has ever maintained it:
-- the department-sync trigger (156/192) only ever ADDS a membership and
-- explicitly never removes one, so people who moved from No Ministry to a real
-- ministry are still sitting on the No Ministry roster.
--
-- Invariant this migration establishes and then enforces with a trigger:
--
--   * Someone with at least one ACTIVE membership in a MAIN ministry
--     (ministry_type = 'main', excluding no_ministry itself) is NOT on the
--     No Ministry roster.
--   * A staff member with ZERO such memberships IS on the No Ministry roster.
--
-- Decisions (confirmed with the product owner):
--   * part_time ministries (e.g. hope_again) do NOT count. Being only in a
--     part-time ministry still means "no ministry".
--   * The removal side applies to LEADER rows too, not just plain members.
--     "Leader of No Ministry" is not a real appointment.
--   * The add side is limited to STAFF, defined as holding the `staff` role.
--     users.signup_type is NOT usable for this — it is NULL for most real
--     staff, so "not a student" would sweep in every ticket buyer, parent and
--     community contact. See NO_MINISTRY_STAFF_ROLES below: if an admin turns
--     out not to hold the `staff` role and should be tracked, widen that list.
--
-- The asymmetry is deliberate: a stale No Ministry row is always wrong once
-- someone is in a real ministry (so remove it for anyone), but only staff
-- should ever be ADDED to the roster.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Ensure the ministry row exists.
--    It was created in the UI, so a fresh environment has no such row and the
--    trigger below would be a silent permanent no-op. ministry_type must be
--    'main' for the invariant to read consistently. src/lib/okrs/summary.ts
--    already excludes this slug from the OKR wall, so creating it adds no
--    empty OKR card.
-- ────────────────────────────────────────────────────────────
INSERT INTO public.staff_ministries (name, slug, sort_order, ministry_type, is_active)
VALUES ('No Ministry', 'no_ministry', 999, 'main', true)
ON CONFLICT (slug) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 2. The sync trigger.
--
--    Modelled on sync_leadership_team_role() (migration 131): AFTER row
--    trigger, SECURITY DEFINER, fixed search_path, COALESCE(NEW, OLD),
--    RETURN NULL.
--
--    RECURSION: this function writes back into its own table, so it must be
--    re-entrant-safe. The PRIMARY guard is the no_ministry identity check —
--    every write this function makes touches a no_ministry row, so any
--    recursive firing exits at that check. That also terminates the
--    delete-our-own-row case (delete → re-fire with OLD.staff_ministry_id =
--    no_ministry → immediate return), rather than looping
--    delete → recompute → re-insert.
--
--    The depth check is deliberately `> 3`, NOT `> 1`: the users.department
--    trigger (156/192) inserts a membership at depth 2 and that insert MUST be
--    processed. A future reader's instinct will be to tighten this to `> 1` —
--    doing so silently breaks the department sync.
--
--    Two triggers now fire on staff_ministry_members. PostgreSQL runs them in
--    name order (staff_ministry_members_leadership_role before
--    staff_ministry_members_no_ministry_sync); they write to different tables,
--    so the ordering does not matter.
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
  -- Secondary circuit-breaker. See the note above on why this is not `> 1`.
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

-- UPDATE is in the event list because `status` flipping pending → active and
-- member_role changes both alter the invariant.
DROP TRIGGER IF EXISTS staff_ministry_members_no_ministry_sync
  ON public.staff_ministry_members;
CREATE TRIGGER staff_ministry_members_no_ministry_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.staff_ministry_members
  FOR EACH ROW EXECUTE FUNCTION public.sync_no_ministry_membership();

-- ────────────────────────────────────────────────────────────
-- 3. One-time backfill, reconciling everyone to the invariant.
-- ────────────────────────────────────────────────────────────

-- (a) Drop stale No Ministry rows for people who have a real main ministry.
DELETE FROM public.staff_ministry_members nm
USING public.staff_ministries sm
WHERE sm.id = nm.staff_ministry_id
  AND sm.slug = 'no_ministry'
  AND EXISTS (
    SELECT 1 FROM public.staff_ministry_members m
    JOIN public.staff_ministries s2 ON s2.id = m.staff_ministry_id
    WHERE m.user_id = nm.user_id
      AND m.status = 'active'
      AND s2.ministry_type = 'main'
      AND s2.slug <> 'no_ministry');

-- (b) Add No Ministry for staff-role holders with zero active main memberships.
INSERT INTO public.staff_ministry_members
  (staff_ministry_id, user_id, member_role, status)
SELECT nm.id, u.id, 'member', 'active'
FROM public.users u
CROSS JOIN public.staff_ministries nm
WHERE nm.slug = 'no_ministry'
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
-- Known gap (accepted for v1)
-- ------------------------------------------------------------
-- Retiring a ministry (is_active = false) or flipping its ministry_type from
-- main to part_time does NOT re-run the invariant, because neither touches
-- staff_ministry_members. If that becomes a problem, add a trigger on
-- staff_ministries.
--
-- Validation (each expects zero rows)
-- ------------------------------------------------------------
--   -- Nobody in a real main ministry is still on No Ministry:
--   SELECT u.email FROM public.staff_ministry_members nm
--   JOIN public.staff_ministries sm
--     ON sm.id = nm.staff_ministry_id AND sm.slug = 'no_ministry'
--   JOIN public.users u ON u.id = nm.user_id
--   WHERE EXISTS (SELECT 1 FROM public.staff_ministry_members m
--     JOIN public.staff_ministries s2 ON s2.id = m.staff_ministry_id
--     WHERE m.user_id = nm.user_id AND m.status = 'active'
--       AND s2.ministry_type = 'main' AND s2.slug <> 'no_ministry');
--
--   -- Every staff-role user with zero main memberships IS on No Ministry:
--   SELECT u.email FROM public.users u
--   WHERE EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r
--                   ON r.id = ur.role_id
--                  WHERE ur.user_id = u.id AND r.name = 'staff')
--     AND NOT EXISTS (SELECT 1 FROM public.staff_ministry_members m
--       JOIN public.staff_ministries s2 ON s2.id = m.staff_ministry_id
--       WHERE m.user_id = u.id AND m.status = 'active'
--         AND s2.ministry_type = 'main' AND s2.slug <> 'no_ministry')
--     AND NOT EXISTS (SELECT 1 FROM public.staff_ministry_members m
--       JOIN public.staff_ministries s2 ON s2.id = m.staff_ministry_id
--       WHERE m.user_id = u.id AND s2.slug = 'no_ministry');
--
--   -- Sanity: how many people the No Ministry roster now holds.
--   SELECT count(*) FROM public.staff_ministry_members m
--   JOIN public.staff_ministries s ON s.id = m.staff_ministry_id
--   WHERE s.slug = 'no_ministry';
-- ============================================================
