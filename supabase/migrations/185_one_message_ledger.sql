-- ============================================================
-- FFSA Hub — Migration 185: one message ledger, and a reason for every send
-- ------------------------------------------------------------
-- Doc 11 asks for a single `messages` table. The Hub already has three
-- ledgers that almost agree:
--
--   email_messages       (141) — transactional + ticket mail, Resend webhook
--   campaign_recipients  (045) — campaign sends
--   workflow_email_sends (071) — workflow step sends
--
-- The latter two carry near-identical delivery columns and neither is
-- wired to a webhook, so a person's mail history needs a three-way union
-- across tables, two of which nothing keeps current. Rather than add a
-- fourth table, this extends email_messages — which is already about 80%
-- of what doc 11 describes — and folds the other two into it.
-- See docs/redesign/94-communications-reconciliation.md.
--
-- The headline addition is `reason`: plain words, written at send time,
-- saying WHY this person got this. Nothing in the Hub records that today,
-- and it is what turns "she says she got an email" into an answer.
--
-- This migration is SCHEMA ONLY and changes no behaviour on its own. The
-- backfill lives in 186 and must run AFTER the code that reads these
-- columns is deployed. Ordering matters: contact-email-history.ts already
-- unions the three tables, so backfilled rows would appear twice until it
-- learns to skip them. Apply 185 -> deploy -> apply 186 and there is no
-- window where anyone sees a doubled history.
--
-- Nothing is dropped. campaign_recipients and workflow_email_sends stay
-- exactly as they are — v_campaign_stats (174) still reads the former and
-- the campaign sender still writes it. Moving those is a later step.
-- ============================================================

-- ── 1. The columns doc 11 asks for that email_messages lacks ──
ALTER TABLE public.email_messages
  -- WHY she got it, in plain words. Never an enum: "She is in DTS 26-2
  -- students" survives a schema change, AUDIENCE_RULE_47 does not.
  ADD COLUMN IF NOT EXISTS reason           text,
  ADD COLUMN IF NOT EXISTS channel          text NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS from_identity_id uuid
    REFERENCES public.sending_identities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS first_clicked_at timestamptz,
  ADD COLUMN IF NOT EXISTS unsubscribed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS replied_at       timestamptz,
  -- Today only first-touch timestamps exist. Counts are additive: a second
  -- open bumps the count and leaves opened_at alone.
  ADD COLUMN IF NOT EXISTS opened_count     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clicked_count    integer NOT NULL DEFAULT 0,
  -- Provenance, so the backfill below can run twice safely.
  ADD COLUMN IF NOT EXISTS legacy_table     text,
  ADD COLUMN IF NOT EXISTS legacy_id        uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_messages_channel_check'
  ) THEN
    ALTER TABLE public.email_messages
      ADD CONSTRAINT email_messages_channel_check
      CHECK (channel IN ('email', 'in_hub'));
  END IF;
END $$;

-- NULL legacy_table/legacy_id (every native row) never collide: NULL is
-- distinct here. Only migrated rows participate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_messages_legacy
  ON public.email_messages(legacy_table, legacy_id);

CREATE INDEX IF NOT EXISTS idx_email_messages_contact_sent
  ON public.email_messages(contact_id, sent_at DESC);

-- ── 2. The person log (frame 29d) as one view over one table ──
-- security_invoker so the view respects the caller's RLS rather than the
-- owner's. A view without it runs as its OWNER and leaks — migration 049
-- asserted the opposite and 166 had to fix it.
DROP VIEW IF EXISTS public.v_person_messages;
CREATE VIEW public.v_person_messages
WITH (security_invoker = true) AS
SELECT
  m.id,
  m.contact_id,
  m.to_email,
  m.channel,
  m.category,
  m.subject,
  m.reason,
  m.status,
  m.sent_at,
  m.delivered_at,
  m.opened_at,
  m.first_clicked_at,
  m.bounced_at,
  m.bounce_type,
  m.complained_at,
  m.unsubscribed_at,
  m.replied_at,
  m.source_type,
  m.source_id,
  si.display_name AS from_identity,
  -- Whether this row came from a folded-in ledger, so the UI can say so
  -- while the two old tables still exist.
  m.legacy_table
FROM public.email_messages m
LEFT JOIN public.sending_identities si ON si.id = m.from_identity_id;

COMMENT ON COLUMN public.email_messages.reason IS
  'Why this person received this, in plain words, written at send time. Frame 29d reads it. Never an enum.';
COMMENT ON VIEW public.v_person_messages IS
  'Frame 29d person log: every message to a person, one row each, across campaigns, workflows and transactional mail.';
