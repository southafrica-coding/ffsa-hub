-- ============================================================
-- FFSA Hub — Migration 143: Department sourced from the Ministry tab
-- ============================================================
-- The profile Department dropdown now reads its options live from
-- public.staff_ministries (the admin-managed Ministry tab), making
-- that table the single source of truth for departments.
--
-- The old static value guard (users_department_check, migration 111)
-- hardcoded the 9 department slugs, so any ministry an admin adds in
-- the Ministry tab could not be saved to a profile. Drop it; the
-- profile-update API now validates department against the real
-- staff_ministries rows instead.
--
-- No data changes: existing users.department values already match
-- staff_ministries.slug (leadership_team, prayer_and_worship, hulk, …).
-- ============================================================

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_department_check;

COMMENT ON COLUMN public.users.department IS
  'FFSA department the user predominantly serves in (a staff_ministries.slug). '
  'Options are sourced live from public.staff_ministries (the Ministry tab); '
  'validated in the profile-update API rather than a static CHECK.';
