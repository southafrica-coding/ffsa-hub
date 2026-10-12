-- ============================================================
-- FFSA Hub — Migration 228: Inbound replies
-- ============================================================
-- Until now a reply to any Hub email went nowhere: every identity's reply-to
-- was hello@ffsahub.com, and ffsahub.com had no MX record, so replies
-- bounced back to the person who wrote them.
--
-- With Resend receiving enabled on ffsahub.com, every identity's From
-- address becomes a real inbox. A reply arrives as Resend's email.received
-- webhook; the Hub stores it here, links it to the contact and to the
-- identity (team) it was addressed to, puts it on her timeline, and forwards
-- it to that team's real inboxes (sending_identities.forward_to) with
-- Reply-To set to her, so the team answers her personally from Gmail.
--
-- 1. sending_identities.forward_to — the staff inboxes a team's replies are
--    forwarded to. Empty means "keep it in the Hub Inbox only".
-- 2. sending_identities.reply_to — cleared where it pointed at the dead
--    hello@ffsahub.com, so replies go to the identity's own From address
--    and are routed to the right team.
-- 3. inbound_emails — one row per received email.
-- 4. activity_events gains 'email_replied' for the contact timeline.
--
-- Re-runnable.
-- ============================================================

-- ── 1. Per-identity forwarding list ─────────────────────────
ALTER TABLE public.sending_identities
  ADD COLUMN IF NOT EXISTS forward_to text[] NOT NULL DEFAULT '{}';

-- ── 2. Replies go to the identity's own address ─────────────
UPDATE public.sending_identities
SET reply_to = NULL
WHERE lower(btrim(reply_to)) = 'hello@ffsahub.com';

-- ── 3. Received emails ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inbound_emails (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Resend's id for the received email; the webhook dedupes on it.
  resend_email_id    text NOT NULL UNIQUE,
  message_id         text,
  in_reply_to        text,
  from_email         text NOT NULL,
  from_name          text,
  to_emails          text[] NOT NULL DEFAULT '{}',
  cc_emails          text[] NOT NULL DEFAULT '{}',
  subject            text,
  text_body          text,
  html_body          text,
  -- [{ id, filename, size, content_type }] — metadata only; files stay at Resend.
  attachments        jsonb NOT NULL DEFAULT '[]'::jsonb,
  received_at        timestamptz NOT NULL DEFAULT now(),
  identity_id        uuid REFERENCES public.sending_identities(id) ON DELETE SET NULL,
  contact_id         uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  -- Out-of-office / auto-responder: kept, but not forwarded or counted as new.
  is_auto_reply      boolean NOT NULL DEFAULT false,
  status             text NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new', 'read', 'handled', 'archived')),
  handled_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  handled_at         timestamptz,
  forwarded_to       text[] NOT NULL DEFAULT '{}',
  forwarded_at       timestamptz,
  forward_error      text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inbound_emails_received
  ON public.inbound_emails (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbound_emails_identity
  ON public.inbound_emails (identity_id);
CREATE INDEX IF NOT EXISTS idx_inbound_emails_contact
  ON public.inbound_emails (contact_id)
  WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inbound_emails_status
  ON public.inbound_emails (status);

ALTER TABLE public.inbound_emails ENABLE ROW LEVEL SECURITY;

-- Read + triage (status changes): the communications team, same set as
-- campaign recipients (migration 091). Inserts come only from the webhook via
-- the service role, which bypasses RLS.
DROP POLICY IF EXISTS "Comms can read inbound emails" ON public.inbound_emails;
CREATE POLICY "Comms can read inbound emails"
  ON public.inbound_emails FOR SELECT
  USING (
    public.is_admin() OR public.has_role('comms_admin')
    OR public.has_permission('communications.send_emails')
    OR public.has_permission('communications.send_announcements')
    OR public.has_permission('communications.manage_templates')
    OR public.has_permission('campaigns.draft')
  );

DROP POLICY IF EXISTS "Comms can triage inbound emails" ON public.inbound_emails;
CREATE POLICY "Comms can triage inbound emails"
  ON public.inbound_emails FOR UPDATE
  USING (
    public.is_admin() OR public.has_role('comms_admin')
    OR public.has_permission('communications.send_emails')
    OR public.has_permission('communications.send_announcements')
    OR public.has_permission('communications.manage_templates')
    OR public.has_permission('campaigns.draft')
  )
  WITH CHECK (
    public.is_admin() OR public.has_role('comms_admin')
    OR public.has_permission('communications.send_emails')
    OR public.has_permission('communications.send_announcements')
    OR public.has_permission('communications.manage_templates')
    OR public.has_permission('campaigns.draft')
  );

-- ── 4. Timeline event type ─────────────────────────────────
-- Same list as migration 074 plus 'email_replied'. NOT VALID: existing rows
-- aren't re-checked, so this can't fail on history; new rows are.
ALTER TABLE public.activity_events
  DROP CONSTRAINT IF EXISTS activity_events_event_type_check;
ALTER TABLE public.activity_events
  ADD CONSTRAINT activity_events_event_type_check
  CHECK (event_type IN (
    'contact_created', 'contact_updated', 'contact_merged',
    'label_added', 'label_removed',
    'form_submitted',
    'csv_imported',
    'event_attended',
    'email_sent', 'email_delivered', 'email_opened',
    'email_clicked', 'email_bounced', 'email_complained', 'email_unsubscribed',
    'email_replied',
    'note_added',
    'manual_interaction',
    'ticket_purchased', 'ticket_refunded', 'ticket_checked_in',
    'workflow_enrolled', 'workflow_email_sent', 'workflow_completed', 'workflow_cancelled',
    'followup_assigned', 'followup_finished', 'followup_note',
    'scheduling_requested', 'scheduling_slots_submitted', 'scheduling_confirmed', 'scheduling_cancelled'
  )) NOT VALID;
