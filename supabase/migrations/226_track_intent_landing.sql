-- ============================================================
-- FFSA Hub — Migration 226: track-intent answers land in the school
-- ============================================================
-- Migration 222's survey kept its answers in its own table, so nothing in the
-- Hub could see them. This (1) adds a reminder stamp so a reminder can only go
-- once per person, and (2) copies every answer already given onto the real
-- track tables (application_segment_choices, then enrollment_segments for
-- accepted students with no billing plan) so the roster tag and the school's
-- Track tab count them. Idempotent — safe to run twice.
-- ============================================================

ALTER TABLE public.ffx_track_intent_surveys
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

-- Whole-programme answers → one NULL-course row.
INSERT INTO public.application_segment_choices (application_response_id, billing_course_id)
SELECT s.application_response_id, NULL
  FROM public.ffx_track_intent_surveys s
 WHERE s.submitted_at IS NOT NULL
   AND COALESCE((s.intent->>'whole_program')::boolean, false) = true
   AND NOT EXISTS (
     SELECT 1 FROM public.application_segment_choices c
      WHERE c.application_response_id = s.application_response_id);

-- Segment answers → one row per chosen course (codes matched within the program).
INSERT INTO public.application_segment_choices (application_response_id, billing_course_id)
SELECT s.application_response_id, bc.id
  FROM public.ffx_track_intent_surveys s
  JOIN public.application_responses ar ON ar.id = s.application_response_id
 CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(s.intent->'segments', '[]'::jsonb)) AS picked(code)
  JOIN public.billing_courses bc ON bc.program_id = ar.program_id AND bc.code = picked.code
 WHERE s.submitted_at IS NOT NULL
   AND COALESCE((s.intent->>'whole_program')::boolean, false) = false
   AND NOT EXISTS (
     SELECT 1 FROM public.application_segment_choices c
      WHERE c.application_response_id = s.application_response_id);

-- Accepted + enrolled + not yet billed → carry onto the enrolment.
INSERT INTO public.enrollment_segments (enrollment_id, billing_course_id)
SELECT e.id, c.billing_course_id
  FROM public.application_segment_choices c
  JOIN public.ffx_track_intent_surveys s ON s.application_response_id = c.application_response_id AND s.submitted_at IS NOT NULL
  JOIN public.application_responses ar ON ar.id = c.application_response_id AND ar.status = 'accepted'
  JOIN public.enrollments e ON e.user_id = ar.user_id AND e.program_id = ar.program_id AND e.removed_at IS NULL
 WHERE NOT EXISTS (SELECT 1 FROM public.enrollment_segments x WHERE x.enrollment_id = e.id)
   AND NOT EXISTS (SELECT 1 FROM public.student_billing_plans p WHERE p.enrollment_id = e.id);

-- ------------------------------------------------------------
-- ROLLBACK (the backfilled rows can't be told apart from real ones, so this
-- only removes the column):
--   ALTER TABLE public.ffx_track_intent_surveys DROP COLUMN IF EXISTS reminder_sent_at;
-- ------------------------------------------------------------
