-- 230: Schedule the HUB setup invite for accepted school applicants
--
-- Accepting a new applicant used to email their 30-day /setup link the same
-- day, so students accepted months ahead had HUB accounts long before they
-- arrived. The setup link now goes out one month before the school starts
-- (or on a date the school sets), and the acceptance email that goes out on
-- the day says when to expect it.
--
--   programs.setup_invite_date   Optional override for when setup links go
--                                out. NULL = one month before the earliest
--                                billing_courses.start_date.
--   users.setup_invite_due_on    Set at acceptance when the link is held
--                                back; the daily cron sends it on/after this
--                                date and clears it. Cleared too whenever a
--                                setup link is sent by hand.

ALTER TABLE public.programs
  ADD COLUMN IF NOT EXISTS setup_invite_date date;

COMMENT ON COLUMN public.programs.setup_invite_date IS
  'When accepted applicants get their HUB setup link. NULL = one month before the school''s first course start date.';

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS setup_invite_due_on date;

COMMENT ON COLUMN public.users.setup_invite_due_on IS
  'Date the held-back HUB setup link is due to be emailed (cron send-setup-invites). NULL = nothing scheduled.';

CREATE INDEX IF NOT EXISTS users_setup_invite_due_on_idx
  ON public.users (setup_invite_due_on)
  WHERE setup_invite_due_on IS NOT NULL;

-- FFSAX 2027 starts 2027-02-05; its leaders want links out on 15 January.
UPDATE public.programs
  SET setup_invite_date = DATE '2027-01-15'
  WHERE code = 'FFSAX2027';
