-- ════════════════════════════════════════════════════════════
-- 242 — An event's own wording on its emails
-- ════════════════════════════════════════════════════════════
-- Per event, per email (ticket confirmation, pay-later invoice, refund,
-- cancellation notice, feedback invite / reminder): its own subject line
-- and/or a message of its own, set on the event's Emails tab with a live
-- preview and "send me a test". The message sits inside the email's normal
-- design — tickets, totals and links are never lost to an edit.
--
--   { "ticket_confirmation": { "subject": "...", "message": "..." }, ... }
--
-- Merge tags [First Name] and [Event] fill per recipient. An email with no
-- entry sends exactly as before.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS email_wording jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.events.email_wording IS
  'Per-email subject/message overrides: { <email key>: { subject?, message? } }. Empty = standard wording.';

-- Verify:
--   SELECT email_wording FROM public.events LIMIT 1;
