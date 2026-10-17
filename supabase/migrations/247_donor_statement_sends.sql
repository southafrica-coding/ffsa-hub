-- ════════════════════════════════════════════════════════════
-- 247 — Donor statements: the send log (phase 3)
-- ════════════════════════════════════════════════════════════
-- One row per statement that left the Hub — emailed to a donor, or
-- downloaded to post because there's no usable email. The PDF exactly as
-- sent is kept in the 'donor-statements' bucket (pdf_path), so a lost
-- statement can be re-sent or checked later. The old script deleted every
-- statement after sending; this keeps them all.
--
-- The double-send guard reads this table: a donor (tax_year + donor_key)
-- with a 'sent' row is skipped unless finance explicitly re-sends.
--
-- Written only by service-role routes; finance can read it.
--
-- Idempotent. Safe to re-run.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.donor_statement_sends (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           uuid REFERENCES public.donor_statement_runs(id) ON DELETE SET NULL,
  tax_year         integer NOT NULL,
  donor_key        text NOT NULL,
  donor_name       text NOT NULL,
  email            text,
  channel          text NOT NULL CHECK (channel IN ('email', 'paper')),
  status           text NOT NULL DEFAULT 'sending'
                   CHECK (status IN ('sending', 'sent', 'failed')),
  is_resend        boolean NOT NULL DEFAULT false,
  total_cents      integer NOT NULL,
  gift_count       integer NOT NULL,
  pdf_path         text,
  file_name        text NOT NULL,
  provider_id      text,             -- Resend message id
  error            text,
  sent_by          uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz
);

CREATE INDEX IF NOT EXISTS idx_dss_donor ON public.donor_statement_sends (tax_year, donor_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dss_run ON public.donor_statement_sends (run_id, created_at DESC);

ALTER TABLE public.donor_statement_sends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read donor statement sends" ON public.donor_statement_sends;
CREATE POLICY "Read donor statement sends"
  ON public.donor_statement_sends FOR SELECT
  USING (public.can_manage_donor_statements());

-- ============================================================
-- Verify:
--   SELECT count(*) FROM public.donor_statement_sends;   -- 0
-- ============================================================
