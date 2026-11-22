-- ============================================================
-- Rollback for 390_hub_forms_f1.sql
-- ============================================================
-- DRAFT. Drops only what 390 added. Anything saved in those
-- columns is lost (the extra weekly-feedback answers, form kinds,
-- departments and submission subjects). The original columns of
-- forms, form_submissions and missio_house_feedback, their rows,
-- and RLS are untouched. Dropping a column drops its CHECK and
-- index with it.
-- ============================================================

DROP INDEX IF EXISTS public.missio_house_feedback_submission_uidx;

ALTER TABLE public.missio_house_feedback
  DROP COLUMN IF EXISTS form_submission_id,
  DROP COLUMN IF EXISTS training_needs,
  DROP COLUMN IF EXISTS activities,
  DROP COLUMN IF EXISTS leader_score,
  DROP COLUMN IF EXISTS welcome_score,
  DROP COLUMN IF EXISTS connected_score,
  DROP COLUMN IF EXISTS testimonies,
  DROP COLUMN IF EXISTS challenge_notes,
  DROP COLUMN IF EXISTS challenge_type,
  DROP COLUMN IF EXISTS win_notes,
  DROP COLUMN IF EXISTS win_type,
  DROP COLUMN IF EXISTS deliverance_count,
  DROP COLUMN IF EXISTS healing_count,
  DROP COLUMN IF EXISTS prophetic_count,
  DROP COLUMN IF EXISTS recommitted_count,
  DROP COLUMN IF EXISTS saved_count,
  DROP COLUMN IF EXISTS invited_count,
  DROP COLUMN IF EXISTS guest_count,
  DROP COLUMN IF EXISTS member_count,
  DROP COLUMN IF EXISTS first_time_count;

DROP INDEX IF EXISTS public.idx_form_submissions_subject;

ALTER TABLE public.form_submissions
  DROP CONSTRAINT IF EXISTS form_submissions_subject_pair_check,
  DROP CONSTRAINT IF EXISTS form_submissions_subject_type_check,
  DROP COLUMN IF EXISTS subject_id,
  DROP COLUMN IF EXISTS subject_type;

DROP INDEX IF EXISTS public.idx_forms_kind;
DROP INDEX IF EXISTS public.idx_forms_department;

ALTER TABLE public.forms
  DROP CONSTRAINT IF EXISTS forms_missio_weekly_subject_check,
  DROP CONSTRAINT IF EXISTS forms_subject_type_check,
  DROP CONSTRAINT IF EXISTS forms_access_mode_check,
  DROP CONSTRAINT IF EXISTS forms_kind_check,
  DROP COLUMN IF EXISTS subject_type,
  DROP COLUMN IF EXISTS access_mode,
  DROP COLUMN IF EXISTS kind,
  DROP COLUMN IF EXISTS department_id;
