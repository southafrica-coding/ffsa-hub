-- ============================================================
-- Add 'cancelled' as a terminal application pipeline status
-- ============================================================
-- Applications can now be marked 'cancelled' (applicant withdrew,
-- duplicate, or no longer proceeding) as a first-class terminal
-- decision, distinct from the "Removed" archive (removed_at).
-- ============================================================

ALTER TABLE public.application_responses
  DROP CONSTRAINT IF EXISTS application_responses_status_check;

ALTER TABLE public.application_responses
  ADD CONSTRAINT application_responses_status_check
  CHECK (status IN (
    'submitted',
    'waiting_for_references',
    'references_received',
    'interview_scheduled',
    'accepted',
    'rejected',
    'waitlisted',
    'cancelled'
  ));
