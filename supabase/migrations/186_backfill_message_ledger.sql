-- ============================================================
-- FFSA Hub — Migration 186: fold the two old ledgers into email_messages
-- ------------------------------------------------------------
-- RUN THIS AFTER the code from migration 185's PR is deployed.
--
-- contact-email-history.ts unions campaign_recipients, workflow_email_sends
-- and email_messages to build a person's mail history. Once these rows
-- exist in email_messages they are represented twice, so the code must
-- already be skipping rows that carry a legacy_table before this runs.
-- Applying it early is not destructive — it shows doubled history until
-- the deploy catches up.
--
-- Re-runnable. Every migrated row carries the table and id it came from
-- under the unique index from 185, so a second run inserts nothing.
-- Nothing is dropped: campaign_recipients still backs v_campaign_stats
-- (174) and the campaign sender's resume logic.
-- ============================================================

-- ── 2. Fold campaign_recipients in ──
-- status is derived from the timestamps, most-final first, mirroring the
-- CHECK on email_messages.
INSERT INTO public.email_messages (
  to_email, contact_id, provider, provider_message_id, category, subject,
  source_type, source_id, status, error, sent_at, delivered_at, opened_at,
  bounced_at, complained_at, first_clicked_at, unsubscribed_at,
  from_identity_id, reason, legacy_table, legacy_id, created_at
)
SELECT
  ce.email,
  cr.contact_id,
  COALESCE(si.provider, 'unknown'),
  cr.provider_message_id,
  'campaign',
  c.subject,
  'campaign',
  c.id,
  CASE
    WHEN cr.bounced_at     IS NOT NULL THEN 'bounced'
    WHEN cr.complained_at  IS NOT NULL THEN 'complained'
    WHEN cr.opened_at      IS NOT NULL THEN 'opened'
    WHEN cr.delivered_at   IS NOT NULL THEN 'delivered'
    WHEN cr.sent_at        IS NOT NULL THEN 'sent'
    ELSE 'queued'
  END,
  cr.bounce_reason,
  cr.sent_at, cr.delivered_at, cr.opened_at, cr.bounced_at, cr.complained_at,
  cr.first_clicked_at, cr.unsubscribed_at,
  c.sending_identity_id,
  'Campaign: ' || c.name,
  'campaign_recipients',
  cr.id,
  COALESCE(cr.sent_at, now())
FROM public.campaign_recipients cr
JOIN public.campaigns c ON c.id = cr.campaign_id
LEFT JOIN public.sending_identities si ON si.id = c.sending_identity_id
JOIN LATERAL (
  SELECT e.email
  FROM public.contact_emails e
  WHERE e.contact_id = cr.contact_id
  ORDER BY e.is_primary DESC, e.created_at ASC
  LIMIT 1
) ce ON true
ON CONFLICT (legacy_table, legacy_id) DO NOTHING;

-- ── 3. Fold workflow_email_sends in ──
-- Subject lives in the step's config jsonb; the workflow's name carries the
-- reason. A step with no subject recorded gets NULL rather than a guess.
INSERT INTO public.email_messages (
  to_email, contact_id, provider, provider_message_id, category, subject,
  source_type, source_id, status, error, sent_at, delivered_at, opened_at,
  bounced_at, complained_at, first_clicked_at, unsubscribed_at,
  reason, legacy_table, legacy_id, created_at
)
SELECT
  ce.email,
  wes.contact_id,
  'unknown',
  wes.provider_message_id,
  'workflow',
  ws.config->>'subject',
  'workflow_step',
  wes.step_id,
  CASE
    WHEN wes.bounced_at    IS NOT NULL THEN 'bounced'
    WHEN wes.complained_at IS NOT NULL THEN 'complained'
    WHEN wes.opened_at     IS NOT NULL THEN 'opened'
    WHEN wes.delivered_at  IS NOT NULL THEN 'delivered'
    WHEN wes.sent_at       IS NOT NULL THEN 'sent'
    ELSE 'queued'
  END,
  wes.bounce_reason,
  wes.sent_at, wes.delivered_at, wes.opened_at, wes.bounced_at,
  wes.complained_at, wes.first_clicked_at, wes.unsubscribed_at,
  COALESCE('Workflow: ' || ow.name, 'Workflow email'),
  'workflow_email_sends',
  wes.id,
  COALESCE(wes.sent_at, now())
FROM public.workflow_email_sends wes
LEFT JOIN public.workflow_steps ws     ON ws.id = wes.step_id
LEFT JOIN public.outcome_workflows ow  ON ow.id = wes.workflow_id
JOIN LATERAL (
  SELECT e.email
  FROM public.contact_emails e
  WHERE e.contact_id = wes.contact_id
  ORDER BY e.is_primary DESC, e.created_at ASC
  LIMIT 1
) ce ON true
ON CONFLICT (legacy_table, legacy_id) DO NOTHING;

-- ── 4. Say what was left behind ──
-- to_email is NOT NULL, so a recipient with no address on file cannot be
-- migrated. In practice the senders resolve an address before writing a
-- row, so this should be zero — but silence is how "2 418 became 2 371"
-- happens, and this file will not do that.
DO $$
DECLARE
  skipped_campaign integer;
  skipped_workflow integer;
BEGIN
  SELECT count(*) INTO skipped_campaign
  FROM public.campaign_recipients cr
  WHERE NOT EXISTS (
    SELECT 1 FROM public.contact_emails e WHERE e.contact_id = cr.contact_id
  );

  SELECT count(*) INTO skipped_workflow
  FROM public.workflow_email_sends wes
  WHERE NOT EXISTS (
    SELECT 1 FROM public.contact_emails e WHERE e.contact_id = wes.contact_id
  );

  RAISE NOTICE 'migration 185: % campaign_recipients and % workflow_email_sends rows had no address on file and were NOT migrated.',
    skipped_campaign, skipped_workflow;
END $$;
