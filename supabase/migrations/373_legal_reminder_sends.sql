-- DO NOT APPLY until Jack says so. Needs 370–372 first.
-- ============================================================
-- FFSA Hub — Migration 373: Legal → Documents (reminder send log)
-- ============================================================
-- Step 4 of 4. The 07:00 cron (/api/cron/legal-reminders) claims the day
-- here BEFORE it sends, so a retried or doubled cron run never emails
-- twice: the second insert hits the primary key and the run stops.
--
-- Holds no personal data: the date, how many people were written to, and
-- the ids of the documents and applications mentioned (never titles).
--
-- Service role only. RLS on with no policies, and no grants to anon or
-- authenticated: nobody reads this from the app.
--
-- Additive only. Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.legal_reminder_sends (
  send_date     date PRIMARY KEY,           -- Johannesburg date
  claimed_at    timestamptz NOT NULL DEFAULT now(),
  recipients    integer NOT NULL DEFAULT 0 CHECK (recipients >= 0),
  sent          integer NOT NULL DEFAULT 0 CHECK (sent >= 0),
  document_ids  uuid[] NOT NULL DEFAULT '{}',
  application_ids uuid[] NOT NULL DEFAULT '{}',
  error         text
);

ALTER TABLE public.legal_reminder_sends ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.legal_reminder_sends FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.legal_reminder_sends TO service_role;

-- ============================================================
-- Validation (run after applying)
-- ------------------------------------------------------------
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'legal_reminder_sends'; -- true
--   SELECT count(*) FROM pg_policies WHERE tablename = 'legal_reminder_sends'; -- 0
-- ============================================================
