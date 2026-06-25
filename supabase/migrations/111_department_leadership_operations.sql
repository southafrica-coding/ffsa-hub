-- ============================================================
-- FFSA Hub — Migration 111: Department options — add Leadership
-- Team + Operations, retire Backbone
-- ============================================================
-- Updates the allowed values for public.users.department (first
-- set up in migration 067):
--   + leadership_team  (new)
--   + operations       (new — effectively replaces backbone)
--   - backbone         (retired)
--
-- "Backbone" was the operational/support department; it is being
-- renamed to "Operations". Everyone currently on backbone is
-- migrated to operations in the same transaction so no row is
-- left holding a value the new CHECK constraint would reject.
--
-- Order matters: drop the old CHECK first so the data UPDATE is
-- free to write 'operations' (not yet in the old list), then add
-- the new CHECK once every row conforms.
-- ============================================================

-- 1. Remove the existing value guard (auto-named by migration 067's
--    inline `ADD COLUMN ... CHECK (...)`).
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_department_check;

-- 2. Migrate everyone off the retired value.
UPDATE public.users
  SET department = 'operations'
  WHERE department = 'backbone';

-- 3. Re-add the guard with the new allowed set.
ALTER TABLE public.users
  ADD CONSTRAINT users_department_check
    CHECK (department IN (
      'leadership_team',
      'prayer_and_worship',
      'media',
      'hulk',
      'operations',
      'training',
      'project_54',
      'education',
      'woven'
    ));

COMMENT ON COLUMN public.users.department IS
  'FFSA department the user predominantly serves in. Set via the profile-completion gate on first login. Allowed values: leadership_team, prayer_and_worship, media, hulk, operations, training, project_54, education, woven.';
