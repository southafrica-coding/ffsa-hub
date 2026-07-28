-- ============================================================
-- FFSA Hub — Migration 141: email delivery ledger
-- ============================================================
-- One row per email the Hub sends, across every provider and every
-- module, so "did this person actually receive it?" becomes a
-- queryable fact instead of something reconstructed after a complaint.
--
-- Motivation: ticket-confirmation emails (and every other send) were
-- fire-and-forget — the send result was only ever console.error'd to
-- Vercel's function logs, which expire. When two Preachers 2026 buyers
-- (paid, tickets issued) never got their confirmation, there was no
-- record anywhere of what happened to the send. This table is that
-- record.
--
-- Lifecycle: a row is written at send time (status 'queued'), flipped
-- to 'sent' when the provider accepts the API call (and we capture its
-- message id), then advanced to 'delivered' / 'opened' / 'bounced' /
-- 'complained' by the provider's delivery webhook, matched on
-- provider_message_id. 'failed' means our own send call errored before
-- the provider ever saw it.
--
-- Keyed on contact_id (nullable) so the same ledger powers a per-person
-- email history on the contact record — and, because event_id/order_id
-- plus a generic (source_type, source_id) pair are all captured, the
-- same table serves events, schools, campaigns and any future module.
--
-- Idempotent: CREATE TABLE / POLICY IF NOT EXISTS + guarded. Safe to
-- re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.email_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who it went to. contact_id is best-effort: many sends happen before
  -- (or without) CRM resolution, so we always store the raw address and
  -- backfill/join the contact when we can.
  to_email            text NOT NULL,
  contact_id          uuid REFERENCES public.contacts(id) ON DELETE SET NULL,

  -- How it was sent.
  provider            text NOT NULL,              -- 'resend' | 'mailtrap'
  provider_message_id text,                       -- id the provider returns; webhook match key

  -- What it was.
  category            text,                        -- 'ticket_confirmation' | 'campaign' | 'school_invite' | ...
  subject             text,

  -- Where it came from. Explicit FKs for the known event tables (so the
  -- Orders tab can join cheaply); a generic (source_type, source_id)
  -- pair for everything else (schools, applications, prayer room, …)
  -- without coupling this table to every module's schema.
  event_id            uuid REFERENCES public.events(id) ON DELETE SET NULL,
  order_id            uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  source_type         text,                        -- e.g. 'school_application', 'reference_invite'
  source_id           uuid,

  -- Delivery state.
  status              text NOT NULL DEFAULT 'queued'
                        CHECK (status IN (
                          'queued','sent','delivered','opened',
                          'bounced','complained','failed','dropped'
                        )),
  error               text,                        -- our send error, or provider bounce reason
  bounce_type         text,                        -- 'hard' | 'soft' when known

  -- Lifecycle timestamps (each set once, by the event that caused it).
  sent_at             timestamptz,
  delivered_at        timestamptz,
  opened_at           timestamptz,
  bounced_at          timestamptz,
  complained_at       timestamptz,

  -- Last raw provider payload, for debugging a weird delivery.
  raw_event           jsonb,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Webhooks look rows up by provider message id; the admin surfaces query
-- by order / event / contact. Index every hot path.
CREATE INDEX IF NOT EXISTS email_messages_provider_msg_idx
  ON public.email_messages (provider, provider_message_id);
CREATE INDEX IF NOT EXISTS email_messages_order_idx
  ON public.email_messages (order_id);
CREATE INDEX IF NOT EXISTS email_messages_event_idx
  ON public.email_messages (event_id);
CREATE INDEX IF NOT EXISTS email_messages_contact_idx
  ON public.email_messages (contact_id);
CREATE INDEX IF NOT EXISTS email_messages_to_email_idx
  ON public.email_messages (lower(to_email));
CREATE INDEX IF NOT EXISTS email_messages_created_idx
  ON public.email_messages (created_at DESC);

-- keep updated_at honest
CREATE OR REPLACE FUNCTION public.touch_email_messages_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_email_messages_updated_at ON public.email_messages;
CREATE TRIGGER trg_email_messages_updated_at
  BEFORE UPDATE ON public.email_messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_email_messages_updated_at();

-- ────────────────────────────────────────────────────────────
-- RLS. Writes happen from the service role (send wrapper + provider
-- webhooks), which bypasses RLS entirely. Reads happen in the admin
-- UI under an authenticated session, so we grant SELECT to the same
-- staff who can already see the modules this ledger reports on:
-- admins, the events/finance roles, and anyone with the relevant
-- view permission (events / communications / contacts).
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read email messages" ON public.email_messages;
CREATE POLICY "Staff can read email messages"
  ON public.email_messages FOR SELECT
  USING (
    public.is_admin()
    OR public.has_role('events_admin')
    OR public.has_role('finance_admin')
    OR public.has_permission('events.view')
    OR public.has_permission('communications.view')
    OR public.has_permission('contacts.view')
  );

COMMENT ON TABLE public.email_messages IS
  'One row per email the Hub sends, across all providers and modules. Written at send time (queued→sent), advanced by provider delivery webhooks (delivered/opened/bounced/complained) matched on provider_message_id. failed = our send errored before the provider saw it. Keyed on contact_id for a per-person email history.';

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'email_messages' ORDER BY ordinal_position;
--   SELECT policyname FROM pg_policies WHERE tablename = 'email_messages';
-- ============================================================
