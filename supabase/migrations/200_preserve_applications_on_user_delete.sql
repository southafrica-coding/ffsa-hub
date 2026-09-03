-- ============================================================
-- 200 — Deleting a person must not delete their application
-- ============================================================
-- application_responses.user_id was declared ON DELETE CASCADE (migration
-- 007), so removing a user hard-deleted every application they had ever
-- submitted. No soft-delete, no trash, no audit trail of the application
-- itself — the row simply ceased to exist.
--
-- This fired routinely: an applicant mistypes their email at apply time,
-- can't log into the account created for that address, registers again with
-- the correct one, an admin tidies up the duplicate — and the accepted
-- application is destroyed as a side effect. Four Leadership Track
-- applications were lost this way in one recent cleanup pass, and 14 user
-- deletions since 1 August each carried the same risk.
--
-- user_id has been nullable since migration 018 (public applicants never had
-- one), and the Applicants list already renders an application with no user
-- by falling back to applicant_email / applicant_info. So SET NULL leaves a
-- perfectly displayable, re-linkable record instead of a hole. This mirrors
-- what delete-user already does deliberately for consent_records and
-- event_roles — applications just never got the same care.
-- ============================================================

ALTER TABLE public.application_responses
  DROP CONSTRAINT IF EXISTS application_responses_user_id_fkey;

ALTER TABLE public.application_responses
  ADD CONSTRAINT application_responses_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON CONSTRAINT application_responses_user_id_fkey ON public.application_responses IS
  'SET NULL, not CASCADE: deleting a person orphans their application (kept, '
  'identified by applicant_email/applicant_info) rather than destroying it.';
