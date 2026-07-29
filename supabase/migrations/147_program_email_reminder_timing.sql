-- ============================================================
-- FFSA Hub — Migration 147: scheduled reminder timing
-- ============================================================
-- Adds the "when" to the per-program email editor (migration 146). For
-- reminder-type emails, a leader can set how many days after the trigger
-- the reminder should auto-send. Today only the reference reminder uses
-- it: set reminder_after_days on a program's reference_reminder template
-- and a daily cron (/api/cron/school-reminders) auto-nudges referees who
-- haven't returned a reference after that many days — instead of a leader
-- having to click remind on each one.
--
-- null = no auto-reminder (current behaviour: manual reminder only).
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE public.program_email_templates
  ADD COLUMN IF NOT EXISTS reminder_after_days integer
    CHECK (reminder_after_days IS NULL OR reminder_after_days BETWEEN 1 AND 90);

COMMENT ON COLUMN public.program_email_templates.reminder_after_days IS
  'For reminder-type emails (e.g. reference_reminder): auto-send this many days after the trigger. null = manual only. Driven by /api/cron/school-reminders.';

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   SELECT email_type, reminder_after_days FROM public.program_email_templates
--   WHERE reminder_after_days IS NOT NULL;
-- ============================================================
