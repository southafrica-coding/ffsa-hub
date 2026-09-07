-- ============================================================
-- 207 — Deleting a person must not delete their enrolment
-- ============================================================
-- enrollments.user_id was declared ON DELETE CASCADE (migration 006), so
-- removing a user hard-deleted every enrolment they held. The row didn't go
-- to the Removed bin (migration 121's removed_at) — it ceased to exist, and
-- with it the student's place on the programme's Arrival tab, their grades
-- (grades cascade off enrollment_id) and their billing linkage.
--
-- This has now fired twice on the same cleanup pattern: an admin deletes a
-- duplicate or unused profile, and a student silently disappears from the
-- arrival roster with no trace to restore from.
--
-- Migration 200 fixed exactly this for application_responses. Enrolments get
-- the same treatment: SET NULL instead of CASCADE, plus a small identity
-- snapshot (person_email / person_info) that delete-user stamps onto the row
-- before the account goes, so an orphaned enrolment still renders as a named
-- person on the roster instead of a blank line. This mirrors what delete-user
-- already does for consent_records, event_roles and applications.
--
-- UNIQUE (user_id, program_id) is unaffected: Postgres treats NULLs as
-- distinct, so any number of orphaned enrolments can coexist on a programme.
-- ============================================================

ALTER TABLE public.enrollments
  ADD COLUMN IF NOT EXISTS person_email text,
  ADD COLUMN IF NOT EXISTS person_info  jsonb;

COMMENT ON COLUMN public.enrollments.person_email IS
  'Identity snapshot written by delete-user just before the account is removed, '
  'so an enrolment orphaned by ON DELETE SET NULL still names its student. '
  'NULL while the user row is alive — read users.email then.';

COMMENT ON COLUMN public.enrollments.person_info IS
  'Companion to person_email: {first_name, last_name, preferred_name, nationality} '
  'snapshotted at deletion time. Mirrors application_responses.applicant_info.';

ALTER TABLE public.enrollments
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.enrollments
  DROP CONSTRAINT IF EXISTS enrollments_user_id_fkey;

ALTER TABLE public.enrollments
  ADD CONSTRAINT enrollments_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON CONSTRAINT enrollments_user_id_fkey ON public.enrollments IS
  'SET NULL, not CASCADE: deleting a person orphans their enrolment (kept, '
  'identified by person_email/person_info) rather than destroying it along '
  'with its grades and its place on the Arrival tab.';
