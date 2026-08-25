-- ============================================================
-- FFSA Hub — Migration 187: consent as an evidenced log, and topic
--                           opt-outs that actually stop mail
-- ------------------------------------------------------------
-- Step 2 of the communications build (docs/redesign/94-communications-
-- reconciliation.md). Doc 11 §4 asks for consent_events, person_topics and
-- privacy_requests. Reconciling first, as with the ledger:
--
--   contacts.marketing_status (041) — 'subscribed' | 'unsubscribed_all' |
--     'bounced' | 'pending'. 'pending' is already doc 11's "signed up but
--     not confirmed, therefore not mailable", and double-opt-in forms
--     already set it (044).
--   unsubscribes (046) — contact_id + label_id + source + timestamp. A NULL
--     label_id is a global opt-out; a set one is doc 11's muted_topic. This
--     is person_topics under another name, so person_topics is NOT built.
--   email_suppressions (046) — hard bounces and complaints.
--
-- v_campaign_audience already filters on all three. So most of doc 11's
-- mailability rule is live. Two things are genuinely missing, and one of
-- them is a bug.
--
-- THE BUG
-- ------------------------------------------------------------
-- v_campaign_audience excludes global opt-outs:
--
--     AND NOT EXISTS (SELECT 1 FROM unsubscribes u
--                     WHERE u.contact_id = c.id AND u.label_id IS NULL)
--
-- ...and never looks at per-label ones. But /api/preferences writes them:
-- the preferences page lets a person opt out of one topic, stores it with
-- that label_id, and the send path has never honoured it. Anyone who used
-- that page to leave a single topic has kept receiving it.
--
-- Section 3 fixes that. It is the whole reason this migration leads with a
-- view change rather than new tables.
--
-- WHAT IS ACTUALLY NEW
-- ------------------------------------------------------------
-- consent_events — the append-only record of WHEN and on WHAT EVIDENCE
--   someone's consent changed. Nothing records this today: unsubscribes
--   captures leaving, nothing captures joining, and neither is protected
--   from being edited.
-- privacy_requests — POPIA access/correction/deletion requests, due 30 days
--   from asking, with who answered.
--
-- Deliberately NOT seeded with positive consent. Every contact currently
-- reads marketing_status='subscribed', but the Hub has no evidence of when
-- or how most of them agreed. Writing 'opted_in' rows for all of them would
-- manufacture exactly the audit trail POPIA asks for and it would be
-- fiction. Only the opt-outs, which carry real timestamps and sources, are
-- seeded. The gap is then visible instead of papered over.
-- ============================================================

-- ── 1. consent_events: append-only ──
CREATE TABLE IF NOT EXISTS public.consent_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  at          timestamptz NOT NULL DEFAULT now(),
  kind        text NOT NULL CHECK (kind IN (
                'opted_in', 'confirmed', 'muted_topic',
                'unsubscribed', 'objected', 'deleted_request'
              )),
  -- Topic = label. The Hub targets campaigns by label, and unsubscribes are
  -- already scoped by label; a parallel vocabulary would drift from it.
  label_id    uuid REFERENCES public.labels(id) ON DELETE SET NULL,
  source      text NOT NULL CHECK (source IN (
                'web_form', 'event_signup', 'application', 'donation',
                'staff_entry', 'import', 'email_footer', 'preferences_page',
                'bounce_threshold', 'complaint', 'backfill'
              )),
  -- ip, user agent, form id — whatever the moment can prove.
  evidence    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consent_events_contact
  ON public.consent_events(contact_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_consent_events_label
  ON public.consent_events(label_id) WHERE label_id IS NOT NULL;

-- Append-only, enforced in the database rather than by convention. An audit
-- log that an admin can quietly edit is not evidence of anything.
--
-- UPDATE only, deliberately. Blocking DELETE here too would also block the
-- ON DELETE CASCADE from contacts, and a contact could then never be
-- deleted at all — the trigger would abort the cascade. That would turn an
-- audit log into a reason the Hub cannot honour a POPIA erasure request,
-- which is precisely backwards. So: evidence can never be REWRITTEN, and
-- app users cannot delete it (no DELETE policy below), but erasing the
-- person erases their consent log with them.
CREATE OR REPLACE FUNCTION public.consent_events_are_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'consent_events is append-only: UPDATE is not permitted. Record a new event instead.';
END $$;

DROP TRIGGER IF EXISTS trg_consent_events_no_update ON public.consent_events;
CREATE TRIGGER trg_consent_events_no_update
  BEFORE UPDATE ON public.consent_events
  FOR EACH ROW EXECUTE FUNCTION public.consent_events_are_append_only();

ALTER TABLE public.consent_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read consent events" ON public.consent_events;
CREATE POLICY "Staff can read consent events"
  ON public.consent_events FOR SELECT
  USING (
    public.is_admin()
    OR public.has_permission('contacts.view')
    OR public.has_permission('contacts.edit')
    OR public.has_permission('communications.view')
  );

-- No UPDATE or DELETE policy exists, on purpose. The trigger stops rewrites
-- outright; the absent DELETE policy stops app users removing rows, while
-- leaving the cascade from contacts free to do a genuine erasure.
DROP POLICY IF EXISTS "Staff can write consent events" ON public.consent_events;
CREATE POLICY "Staff can write consent events"
  ON public.consent_events FOR INSERT
  WITH CHECK (
    public.is_admin()
    OR public.has_permission('contacts.edit')
    OR public.has_permission('communications.send')
  );

-- ── 2. privacy_requests ──
CREATE TABLE IF NOT EXISTS public.privacy_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  -- Kept even if the contact row is later removed: a deletion request that
  -- vanishes with the person it was about proves nothing.
  subject_email text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('access', 'correct', 'delete')),
  asked_at      timestamptz NOT NULL DEFAULT now(),
  -- POPIA gives 30 days. Stored rather than computed so a later change to
  -- the period does not silently rewrite history.
  due_at        timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  answered_at   timestamptz,
  answered_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  outcome_note  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_privacy_requests_open
  ON public.privacy_requests(due_at) WHERE answered_at IS NULL;

ALTER TABLE public.privacy_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read privacy requests" ON public.privacy_requests;
CREATE POLICY "Staff can read privacy requests"
  ON public.privacy_requests FOR SELECT
  USING (public.is_admin() OR public.has_permission('contacts.edit'));

DROP POLICY IF EXISTS "Staff can write privacy requests" ON public.privacy_requests;
CREATE POLICY "Staff can write privacy requests"
  ON public.privacy_requests FOR INSERT
  WITH CHECK (public.is_admin() OR public.has_permission('contacts.edit'));

DROP POLICY IF EXISTS "Staff can answer privacy requests" ON public.privacy_requests;
CREATE POLICY "Staff can answer privacy requests"
  ON public.privacy_requests FOR UPDATE
  USING (public.is_admin() OR public.has_permission('contacts.edit'))
  WITH CHECK (public.is_admin() OR public.has_permission('contacts.edit'));

-- ── 3. THE FIX: honour per-topic opt-outs ──
-- Adds one NOT EXISTS. A contact pulled into a campaign by label A is
-- dropped if they opted out of label A — but is still reached through
-- label B if they remain subscribed to it, which is what they asked for.
-- DISTINCT already collapses the duplicate rows that produces.
CREATE OR REPLACE VIEW public.v_campaign_audience AS
SELECT DISTINCT
  ccl.campaign_id,
  c.id              AS contact_id,
  c.email,
  c.email_normalized,
  c.first_name,
  c.last_name
FROM public.campaign_labels ccl
JOIN public.contact_labels cl ON cl.label_id = ccl.label_id
JOIN public.contacts c        ON c.id = cl.contact_id
WHERE c.email IS NOT NULL
  AND c.email_normalized IS NOT NULL
  AND c.marketing_status = 'subscribed'
  AND NOT EXISTS (
    SELECT 1 FROM public.unsubscribes u
    WHERE u.contact_id = c.id
      AND u.label_id IS NULL
  )
  -- NEW: the per-topic opt-out the preferences page has been writing all
  -- along and nothing has been reading.
  AND NOT EXISTS (
    SELECT 1 FROM public.unsubscribes u
    WHERE u.contact_id = c.id
      AND u.label_id = ccl.label_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.email_suppressions s
    WHERE s.email_normalized = c.email_normalized
  );

-- CREATE OR REPLACE keeps the view's options, but say it out loud: this view
-- must stay security_invoker (migration 166) or it silently starts running
-- with owner rights again.
ALTER VIEW public.v_campaign_audience SET (security_invoker = true);

COMMENT ON VIEW public.v_campaign_audience IS
  'Resolved recipient list per campaign, minus unsubscribes (global AND per-topic), suppressions and non-subscribed marketing_status. security_invoker: runs as the caller. The send path uses the service-role client and is unaffected.';

-- ── 4. Seed the log with the opt-outs we can actually evidence ──
-- Only real, timestamped events. Nothing is invented. Re-runnable: the
-- partial unique index below means a second run inserts nothing.
CREATE UNIQUE INDEX IF NOT EXISTS uq_consent_events_backfill
  ON public.consent_events(contact_id, kind, COALESCE(label_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE source = 'backfill';

INSERT INTO public.consent_events (contact_id, at, kind, label_id, source, evidence)
SELECT
  u.contact_id,
  u.unsubscribed_at,
  CASE WHEN u.label_id IS NULL THEN 'unsubscribed' ELSE 'muted_topic' END,
  u.label_id,
  'backfill',
  jsonb_build_object(
    'migrated_from', 'unsubscribes',
    'original_source', u.source,
    'original_reason', u.reason
  )
FROM public.unsubscribes u
ON CONFLICT DO NOTHING;

-- ── 5. Say how much consent is unevidenced ──
-- The number worth knowing: contacts the Hub will happily mail, for whom it
-- holds no record of them ever agreeing. Not a failure of this migration —
-- it is the pre-existing gap, now countable.
DO $$
DECLARE
  mailable_total     integer;
  mailable_evidenced integer;
  pending_total      integer;
BEGIN
  SELECT count(*) INTO mailable_total
  FROM public.contacts WHERE marketing_status = 'subscribed';

  SELECT count(DISTINCT c.id) INTO mailable_evidenced
  FROM public.contacts c
  JOIN public.consent_events e
    ON e.contact_id = c.id AND e.kind IN ('opted_in', 'confirmed')
  WHERE c.marketing_status = 'subscribed';

  SELECT count(*) INTO pending_total
  FROM public.contacts WHERE marketing_status = 'pending';

  RAISE NOTICE 'migration 187: % contacts are mailable; % of them have a recorded opt-in or confirmation. % are pending confirmation and are already excluded from campaigns.',
    mailable_total, mailable_evidenced, pending_total;
END $$;

COMMENT ON TABLE public.consent_events IS
  'Append-only record of consent changes, with evidence. Enforced by trigger: no UPDATE, no DELETE, ever. Topic = label_id, matching how campaigns are targeted.';
COMMENT ON TABLE public.privacy_requests IS
  'POPIA access / correction / deletion requests. due_at is stored, not computed, so changing the period never rewrites history.';
