-- ════════════════════════════════════════════════════════════
-- 241 — Per-event email settings: who it's from, where replies go, the logo
-- ════════════════════════════════════════════════════════════
-- Every email an event sends (ticket confirmation, pay-later invoice,
-- refund, cancellation notice, feedback invites) now follows the event's
-- own settings instead of a sender hard-wired to its brand:
--
--   events.sending_identity_id — the event's sender (sending_identities):
--     From name + address, its Hub reply address (<slug>@ffsahub.com,
--     logged on the buyer's record) and the inboxes replies are forwarded
--     to (forward_to). NULL = the brand's sender, exactly as before.
--   events.email_show_event_logo — put the event's own logo
--     (events.logo_url, migration 055) at the top of its emails.
--
-- Pay-later invoices use the event's sender NAME and address, but replies
-- still go to finance (payment questions belong there).
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS sending_identity_id   uuid REFERENCES public.sending_identities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email_show_event_logo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.sending_identity_id IS
  'Sender for every email this event sends. NULL = the brand''s sending identity.';
COMMENT ON COLUMN public.events.email_show_event_logo IS
  'Show events.logo_url at the top of this event''s emails.';

-- Verify:
--   SELECT sending_identity_id, email_show_event_logo FROM public.events LIMIT 1;
