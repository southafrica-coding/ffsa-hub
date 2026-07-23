-- Track when an applicant was last emailed to supply references they didn't
-- provide at submit time. Powers the "Requested {date}" indicator in the admin
-- review panel and lets staff see who has already been chased so they don't
-- double-send. Nullable: null = never requested.
ALTER TABLE public.application_responses
  ADD COLUMN IF NOT EXISTS references_requested_at timestamptz;
