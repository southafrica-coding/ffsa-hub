-- ============================================================
-- FFSA Hub — Migration 390: Hub Forms F1 (schema only)
-- ============================================================
-- DRAFT. Not applied to any hosted database by the PR that adds
-- this file. Do not apply until Jack OKs it. Previews share prod.
--
-- Depends on 044 (forms, form_submissions), 126 (staff_ministries),
-- 331 (house_churches) and 339 (missio_house_feedback).
-- Numbered 390, not 360: 354–355 are open PRs (#684, #683),
-- 356–359 are held for them, 360–363 are the visa PRs (#622,
-- #629), 370–375 legal documents (#630) and 380 equipment (#451).
-- 390 is the next free block of ten.
--
-- Hub Forms reuses public.forms and public.form_submissions. No
-- second forms table. This migration only adds columns:
--
--   1. forms: department_id, kind, access_mode, subject_type.
--      "Departments" in the Hub are public.staff_ministries (the
--      Ministry tab, see 126 and 143), so department_id points
--      there. Every existing form becomes kind 'generic', access
--      'public', which is what they are today.
--
--   2. form_submissions: subject_type + subject_id. For the Missio
--      weekly feedback the subject is the house (subject_type
--      'house', subject_id = house_churches.id). subject_id has no
--      foreign key because its table depends on subject_type.
--
--   3. missio_house_feedback: the fuller weekly form. The unique
--      (house_church_id, meeting_date), the existing columns, the
--      token link and RLS are unchanged. Every new column is
--      nullable with no default: a row sent before this migration
--      did not ask the question, so it stays null (never a made-up
--      zero). Nothing is backfilled.
--
--      Counts of people (first_time, member, guest, invited) use
--      the same 0–500 range as attendance. The ministry counts
--      (saved, recommitted, prophetic, healing, deliverance) are
--      0–6, where 6 means "more than 5" (the form's stepper tops
--      out there). Scores are 1–5. Text columns are capped like
--      notes (2000); the two *_type columns are short picks (200).
--      activities and training_needs are capped at 20 entries,
--      like new_names.
--
--      form_submission_id links the row to the form_submissions
--      row it came from, ON DELETE SET NULL.
--
-- RLS: unchanged. missio_house_feedback is still read only by the
-- two policies from 339 (pastors; coaches and leaders of that
-- house) and written only by the service role. The new columns
-- inherit that. forms and form_submissions policies from 044 are
-- unchanged too.
--
-- No data. House names are an ops script, not a migration:
-- supabase/scripts/ops/fill_house_church_names.sql.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- constraints dropped before they are added.
-- Rollback: supabase/rollbacks/390_hub_forms_f1.sql.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. forms
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.forms
  ADD COLUMN IF NOT EXISTS department_id uuid
    REFERENCES public.staff_ministries (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'generic',
  ADD COLUMN IF NOT EXISTS access_mode text NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS subject_type text;

ALTER TABLE public.forms DROP CONSTRAINT IF EXISTS forms_kind_check;
ALTER TABLE public.forms
  ADD CONSTRAINT forms_kind_check
  CHECK (kind IN ('generic', 'event', 'department', 'missio_weekly_feedback'));

ALTER TABLE public.forms DROP CONSTRAINT IF EXISTS forms_access_mode_check;
ALTER TABLE public.forms
  ADD CONSTRAINT forms_access_mode_check
  CHECK (access_mode IN ('public', 'logged_in', 'token'));

ALTER TABLE public.forms DROP CONSTRAINT IF EXISTS forms_subject_type_check;
ALTER TABLE public.forms
  ADD CONSTRAINT forms_subject_type_check
  CHECK (
    subject_type IS NULL
    OR subject_type IN ('house', 'contact', 'department', 'event', 'none')
  );

-- The weekly feedback form is always about a house.
ALTER TABLE public.forms DROP CONSTRAINT IF EXISTS forms_missio_weekly_subject_check;
ALTER TABLE public.forms
  ADD CONSTRAINT forms_missio_weekly_subject_check
  CHECK (kind <> 'missio_weekly_feedback' OR subject_type = 'house');

CREATE INDEX IF NOT EXISTS idx_forms_department
  ON public.forms (department_id) WHERE department_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_forms_kind
  ON public.forms (kind);

COMMENT ON COLUMN public.forms.department_id IS
  'Optional owning department (a staff_ministries row). Null for forms that belong to no department.';
COMMENT ON COLUMN public.forms.kind IS
  'generic | event | department | missio_weekly_feedback. Existing forms are generic.';
COMMENT ON COLUMN public.forms.access_mode IS
  'Who may submit: public (anyone with the link), logged_in (a Hub login), token (a per-subject signed link, e.g. a house feedback link).';
COMMENT ON COLUMN public.forms.subject_type IS
  'What each submission is about: house | contact | department | event | none. Null = not set. missio_weekly_feedback forms must be house.';

-- ────────────────────────────────────────────────────────────
-- 2. form_submissions
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.form_submissions
  ADD COLUMN IF NOT EXISTS subject_type text,
  ADD COLUMN IF NOT EXISTS subject_id uuid;

ALTER TABLE public.form_submissions DROP CONSTRAINT IF EXISTS form_submissions_subject_type_check;
ALTER TABLE public.form_submissions
  ADD CONSTRAINT form_submissions_subject_type_check
  CHECK (
    subject_type IS NULL
    OR subject_type IN ('house', 'contact', 'department', 'event', 'none')
  );

-- A subject id needs a subject type to say which table it is in.
ALTER TABLE public.form_submissions DROP CONSTRAINT IF EXISTS form_submissions_subject_pair_check;
ALTER TABLE public.form_submissions
  ADD CONSTRAINT form_submissions_subject_pair_check
  CHECK (subject_id IS NULL OR subject_type IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_form_submissions_subject
  ON public.form_submissions (subject_type, subject_id, submitted_at DESC)
  WHERE subject_id IS NOT NULL;

COMMENT ON COLUMN public.form_submissions.subject_type IS
  'What this submission is about (see forms.subject_type). Null for submissions with no subject, including every row before migration 390.';
COMMENT ON COLUMN public.form_submissions.subject_id IS
  'Id of the subject row; its table depends on subject_type (house = house_churches.id). No foreign key.';

-- ────────────────────────────────────────────────────────────
-- 3. missio_house_feedback
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.missio_house_feedback
  -- People in the room (same range as attendance).
  ADD COLUMN IF NOT EXISTS first_time_count   int,
  ADD COLUMN IF NOT EXISTS member_count       int,
  ADD COLUMN IF NOT EXISTS guest_count        int,
  ADD COLUMN IF NOT EXISTS invited_count      int,
  -- What God did (0–5, 6 = more than 5).
  ADD COLUMN IF NOT EXISTS saved_count        int,
  ADD COLUMN IF NOT EXISTS recommitted_count  int,
  ADD COLUMN IF NOT EXISTS prophetic_count    int,
  ADD COLUMN IF NOT EXISTS healing_count      int,
  ADD COLUMN IF NOT EXISTS deliverance_count  int,
  -- Wins, challenges, stories.
  ADD COLUMN IF NOT EXISTS win_type           text,
  ADD COLUMN IF NOT EXISTS win_notes          text,
  ADD COLUMN IF NOT EXISTS challenge_type     text,
  ADD COLUMN IF NOT EXISTS challenge_notes    text,
  ADD COLUMN IF NOT EXISTS testimonies        text,
  -- Scores, 1–5.
  ADD COLUMN IF NOT EXISTS connected_score    int,
  ADD COLUMN IF NOT EXISTS welcome_score      int,
  ADD COLUMN IF NOT EXISTS leader_score       int,
  -- Picks.
  ADD COLUMN IF NOT EXISTS activities         text[],
  ADD COLUMN IF NOT EXISTS training_needs     text[],
  -- Where it came from.
  ADD COLUMN IF NOT EXISTS form_submission_id uuid
    REFERENCES public.form_submissions (id) ON DELETE SET NULL;

DO $$
DECLARE
  c text;
BEGIN
  -- People counts: 0–500, like attendance.
  FOREACH c IN ARRAY ARRAY['first_time_count', 'member_count', 'guest_count', 'invited_count'] LOOP
    EXECUTE format('ALTER TABLE public.missio_house_feedback DROP CONSTRAINT IF EXISTS %I', 'missio_house_feedback_' || c || '_check');
    EXECUTE format(
      'ALTER TABLE public.missio_house_feedback ADD CONSTRAINT %I CHECK (%I IS NULL OR %I BETWEEN 0 AND 500)',
      'missio_house_feedback_' || c || '_check', c, c
    );
  END LOOP;

  -- Ministry counts: 0–6, 6 = more than 5.
  FOREACH c IN ARRAY ARRAY['saved_count', 'recommitted_count', 'prophetic_count', 'healing_count', 'deliverance_count'] LOOP
    EXECUTE format('ALTER TABLE public.missio_house_feedback DROP CONSTRAINT IF EXISTS %I', 'missio_house_feedback_' || c || '_check');
    EXECUTE format(
      'ALTER TABLE public.missio_house_feedback ADD CONSTRAINT %I CHECK (%I IS NULL OR %I BETWEEN 0 AND 6)',
      'missio_house_feedback_' || c || '_check', c, c
    );
  END LOOP;

  -- Scores: 1–5.
  FOREACH c IN ARRAY ARRAY['connected_score', 'welcome_score', 'leader_score'] LOOP
    EXECUTE format('ALTER TABLE public.missio_house_feedback DROP CONSTRAINT IF EXISTS %I', 'missio_house_feedback_' || c || '_check');
    EXECUTE format(
      'ALTER TABLE public.missio_house_feedback ADD CONSTRAINT %I CHECK (%I IS NULL OR %I BETWEEN 1 AND 5)',
      'missio_house_feedback_' || c || '_check', c, c
    );
  END LOOP;

  -- Short picks: 200 characters.
  FOREACH c IN ARRAY ARRAY['win_type', 'challenge_type'] LOOP
    EXECUTE format('ALTER TABLE public.missio_house_feedback DROP CONSTRAINT IF EXISTS %I', 'missio_house_feedback_' || c || '_check');
    EXECUTE format(
      'ALTER TABLE public.missio_house_feedback ADD CONSTRAINT %I CHECK (%I IS NULL OR char_length(%I) <= 200)',
      'missio_house_feedback_' || c || '_check', c, c
    );
  END LOOP;

  -- Free text: 2000 characters, like notes and prayer.
  FOREACH c IN ARRAY ARRAY['win_notes', 'challenge_notes', 'testimonies'] LOOP
    EXECUTE format('ALTER TABLE public.missio_house_feedback DROP CONSTRAINT IF EXISTS %I', 'missio_house_feedback_' || c || '_check');
    EXECUTE format(
      'ALTER TABLE public.missio_house_feedback ADD CONSTRAINT %I CHECK (%I IS NULL OR char_length(%I) <= 2000)',
      'missio_house_feedback_' || c || '_check', c, c
    );
  END LOOP;

  -- Lists: at most 20 entries, like new_names.
  FOREACH c IN ARRAY ARRAY['activities', 'training_needs'] LOOP
    EXECUTE format('ALTER TABLE public.missio_house_feedback DROP CONSTRAINT IF EXISTS %I', 'missio_house_feedback_' || c || '_check');
    EXECUTE format(
      'ALTER TABLE public.missio_house_feedback ADD CONSTRAINT %I CHECK (%I IS NULL OR cardinality(%I) <= 20)',
      'missio_house_feedback_' || c || '_check', c, c
    );
  END LOOP;
END $$;

-- One feedback row per submission.
CREATE UNIQUE INDEX IF NOT EXISTS missio_house_feedback_submission_uidx
  ON public.missio_house_feedback (form_submission_id)
  WHERE form_submission_id IS NOT NULL;

COMMENT ON COLUMN public.missio_house_feedback.saved_count IS
  '0–5 people saved this week; 6 means more than 5. Null = not asked (rows before migration 390).';
COMMENT ON COLUMN public.missio_house_feedback.recommitted_count IS
  '0–5; 6 means more than 5. Null = not asked.';
COMMENT ON COLUMN public.missio_house_feedback.prophetic_count IS
  '0–5; 6 means more than 5. Null = not asked.';
COMMENT ON COLUMN public.missio_house_feedback.healing_count IS
  '0–5; 6 means more than 5. Null = not asked.';
COMMENT ON COLUMN public.missio_house_feedback.deliverance_count IS
  '0–5; 6 means more than 5. Null = not asked.';
COMMENT ON COLUMN public.missio_house_feedback.leader_score IS
  '1–5. Same readers as prayer (migration 339 policies). Null = not asked.';
COMMENT ON COLUMN public.missio_house_feedback.form_submission_id IS
  'The form_submissions row this feedback came from (Hub Forms). Null for rows sent through the original M4a link before migration 390.';

-- ============================================================
-- Validation (read-only)
-- ------------------------------------------------------------
--   SELECT kind, access_mode, count(*) FROM public.forms GROUP BY 1, 2;
--     -- every existing form: generic / public
--   SELECT count(*) FROM public.missio_house_feedback
--   WHERE saved_count IS NOT NULL OR form_submission_id IS NOT NULL;
--     -- 0 straight after applying
-- ============================================================
