-- ============================================================
-- FFSA Hub — Migration 220: Job description + Workshops/Seminars
-- ------------------------------------------------------------
-- Two additions to the staff CV card (migration 218/219):
--
--   1. users.job_description — a singleton free-text field, same shape as
--      essence_statement, but written only by a ministry leader of one of
--      the staff member's ministries (or an admin) — never by the staff
--      member themselves. Enforced in application code
--      (src/lib/auth/check-cv-access.ts + the dedicated API route), the
--      same way essence_statement's self-only write is — RLS on `users`
--      already allows a user to update their own row broadly (see
--      002_rls_policies.sql "Users can update own user record"), so this
--      column is never added to the self-service /api/profile/update
--      allowlist. Matches this project's existing pattern of gating writes
--      at the route/allowlist layer rather than per-column RLS.
--
--   2. A new 'workshop' CV entry category, distinct from 'training' —
--      'training' is a full YWAM/FF school (DTS, SBS, ICI…); 'workshop' is
--      a shorter one-off workshop or seminar.
-- ============================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS job_description text;

ALTER TABLE public.staff_cv_entries DROP CONSTRAINT IF EXISTS staff_cv_entries_category_check;
ALTER TABLE public.staff_cv_entries ADD CONSTRAINT staff_cv_entries_category_check
  CHECK (category IN ('involvement', 'training', 'workshop', 'skill', 'other'));

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'users' AND column_name = 'job_description';
--
--   INSERT INTO public.staff_cv_entries (user_id, category, title, added_by_role, created_by)
--   VALUES ('<uuid>', 'workshop', 'Conflict resolution workshop', 'self', '<uuid>');
-- ============================================================
