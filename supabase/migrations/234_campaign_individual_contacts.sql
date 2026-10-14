-- ============================================================
-- FFSA Hub — Migration 234: hand-picked contacts on a campaign
-- ============================================================
-- A campaign's audience was only ever "everyone in these labels". This adds
-- individually chosen contacts on top: the composer can search contacts and
-- add them one by one, alone or alongside labels.
--
-- 1. campaign_contacts — one row per hand-picked contact.
-- 2. v_campaign_audience — label members UNION hand-picked contacts, with
--    the same mailability rules for both: subscribed, no global opt-out, not
--    on the suppression list. The per-topic (per-label) opt-out still applies
--    to label members; a hand-picked person was chosen by name rather than
--    by topic, so only their global opt-out applies. DISTINCT across the
--    union means someone in a label AND hand-picked gets one email.
--
-- Re-runnable.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.campaign_contacts (
  campaign_id  uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  contact_id   uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  added_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_contacts_contact
  ON public.campaign_contacts (contact_id);

ALTER TABLE public.campaign_contacts ENABLE ROW LEVEL SECURITY;

-- Same people who may edit a campaign's labels (migration 091).
DROP POLICY IF EXISTS "Comms can manage campaign contacts" ON public.campaign_contacts;
CREATE POLICY "Comms can manage campaign contacts"
  ON public.campaign_contacts FOR ALL
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

CREATE OR REPLACE VIEW public.v_campaign_audience
WITH (security_invoker = true) AS
SELECT DISTINCT campaign_id, contact_id, email, email_normalized, first_name, last_name
FROM (
  -- Everyone in the campaign's labels (unchanged from migration 187).
  SELECT
    ccl.campaign_id,
    c.id AS contact_id,
    c.email,
    c.email_normalized,
    c.first_name,
    c.last_name
  FROM public.campaign_labels ccl
  JOIN public.contact_labels cl ON cl.label_id = ccl.label_id
  JOIN public.contacts c        ON c.id = cl.contact_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.unsubscribes u
    WHERE u.contact_id = c.id
      AND u.label_id = ccl.label_id
  )

  UNION

  -- Hand-picked contacts (this migration).
  SELECT
    cc.campaign_id,
    c.id AS contact_id,
    c.email,
    c.email_normalized,
    c.first_name,
    c.last_name
  FROM public.campaign_contacts cc
  JOIN public.contacts c ON c.id = cc.contact_id
) a
WHERE a.email IS NOT NULL
  AND a.email_normalized IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = a.contact_id AND c.marketing_status = 'subscribed'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.unsubscribes u
    WHERE u.contact_id = a.contact_id
      AND u.label_id IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.email_suppressions s
    WHERE s.email_normalized = a.email_normalized
  );
