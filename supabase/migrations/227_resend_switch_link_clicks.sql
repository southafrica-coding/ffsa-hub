-- ============================================================
-- FFSA Hub — Migration 227: Resend replaces Mailtrap + per-link clicks
-- ============================================================
-- Two things, both from moving every marketing/brand send off Mailtrap and
-- onto Resend:
--
-- 1. sending_identities.provider: every identity now sends through Resend.
--    The column is informational (no code branches on it), but the
--    identities screen shows it, and it should not claim Mailtrap. 'mailtrap'
--    stays legal in the CHECK so historical rows elsewhere still validate.
--
-- 2. email_link_clicks: one row per click on a tracked link, from Resend's
--    email.clicked webhook. campaign_recipients only keeps first_clicked_at,
--    which answers "did she click?" but not "which link, and how often?".
--    This keeps every click, so a campaign can show per-link totals and
--    unique clickers.
--
--    event_id is the webhook delivery id (svix-id). Resend retries a webhook
--    it thinks failed; the unique index makes the retry a no-op instead of a
--    double-counted click.
--
--    No IP address is stored — the per-link report does not need it, and
--    POPIA says not to keep personal data without a purpose.
--
-- Re-runnable.
-- ============================================================

-- ── 1. Identities now send through Resend ──────────────────
UPDATE public.sending_identities
SET provider = 'resend'
WHERE provider = 'mailtrap';

ALTER TABLE public.sending_identities
  ALTER COLUMN provider SET DEFAULT 'resend';

-- ── 2. Per-link click log ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_link_clicks (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id             text,
  provider             text NOT NULL DEFAULT 'resend',
  provider_message_id  text NOT NULL,
  campaign_id          uuid REFERENCES public.campaigns(id) ON DELETE CASCADE,
  workflow_id          uuid,
  contact_id           uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  url                  text NOT NULL,
  user_agent           text,
  clicked_at           timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Not a partial index: the webhook upserts ON CONFLICT (event_id), which only
-- matches a plain unique index. NULLs never collide, so unsigned events (no
-- svix-id) still insert.
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_link_clicks_event
  ON public.email_link_clicks (event_id);
CREATE INDEX IF NOT EXISTS idx_email_link_clicks_campaign
  ON public.email_link_clicks (campaign_id)
  WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_link_clicks_workflow
  ON public.email_link_clicks (workflow_id)
  WHERE workflow_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_link_clicks_contact
  ON public.email_link_clicks (contact_id)
  WHERE contact_id IS NOT NULL;

ALTER TABLE public.email_link_clicks ENABLE ROW LEVEL SECURITY;

-- Read: the same people who manage campaign recipients (migration 091).
-- Writes come only from the webhook, through the service role, which
-- bypasses RLS — so there is deliberately no insert/update policy.
DROP POLICY IF EXISTS "Comms can read link clicks" ON public.email_link_clicks;
CREATE POLICY "Comms can read link clicks"
  ON public.email_link_clicks FOR SELECT
  USING (
    public.is_admin() OR public.has_role('comms_admin')
    OR public.has_permission('communications.send_emails')
    OR public.has_permission('communications.send_announcements')
    OR public.has_permission('communications.manage_templates')
    OR public.has_permission('campaigns.draft')
  );
