-- ============================================================
-- FFSA Hub — Migration 229: Reply to inbound email from the Hub
-- ============================================================
-- Migration 228 brought replies INTO the Hub. This lets staff answer them
-- from the Inbox instead of their own mail app.
--
-- 1. sending_identities.reply_from_email — the team's work address a Hub
--    reply is sent From (e.g. camps@ffsouthafrica.com). Blank falls back to
--    the identity's own from_email. Its domain must be verified in Resend.
--    The reply's Reply-To is always the identity's ffsahub.com address, so
--    when the person answers again it comes back into the Hub Inbox (and is
--    forwarded to the team) rather than leaving the record.
--
-- 2. inbound_email_replies — every reply sent from the Hub, shown as the
--    thread under the inbound email it answers.
--
-- Re-runnable.
-- ============================================================

ALTER TABLE public.sending_identities
  ADD COLUMN IF NOT EXISTS reply_from_email text;

CREATE TABLE IF NOT EXISTS public.inbound_email_replies (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_email_id     uuid NOT NULL REFERENCES public.inbound_emails(id) ON DELETE CASCADE,
  identity_id          uuid REFERENCES public.sending_identities(id) ON DELETE SET NULL,
  contact_id           uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  from_email           text NOT NULL,
  from_name            text NOT NULL,
  reply_to             text,
  to_email             text NOT NULL,
  subject              text NOT NULL,
  body_text            text NOT NULL,
  provider_message_id  text,
  status               text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  error                text,
  sent_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inbound_email_replies_inbound
  ON public.inbound_email_replies (inbound_email_id, sent_at);

ALTER TABLE public.inbound_email_replies ENABLE ROW LEVEL SECURITY;

-- Same people who can read the Inbox (migration 228). Rows are written by
-- the reply API with the service role after its own permission check.
DROP POLICY IF EXISTS "Comms can read inbox replies" ON public.inbound_email_replies;
CREATE POLICY "Comms can read inbox replies"
  ON public.inbound_email_replies FOR SELECT
  USING (
    public.is_admin() OR public.has_role('comms_admin')
    OR public.has_permission('communications.send_emails')
    OR public.has_permission('communications.send_announcements')
    OR public.has_permission('communications.manage_templates')
    OR public.has_permission('campaigns.draft')
  );
