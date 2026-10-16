-- ════════════════════════════════════════════════════════════
-- 243 — Sending domains, self-serve through Resend
-- ════════════════════════════════════════════════════════════
-- Communications → Sending domains lets staff add a domain (e.g.
-- ffglobal.org), see exactly which DNS records to paste in, and check them —
-- without a developer. Resend is the source of truth for whether a domain
-- may send; these columns mirror it so the Hub can show it and so the event
-- "From" picker only ever offers domains Resend has verified.
--
--   resend_domain_id — Resend's id for the domain
--   resend_status    — not_started | pending | verified | failed | temporary_failure
--   resend_records   — the DNS records Resend asks for, with each one's status
--   resend_region    — where Resend sends it from
--   can_send / can_receive — Resend's capabilities (only ffsahub.com receives)
--   resend_checked_at — when the Hub last read it from Resend
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.sending_domains
  ADD COLUMN IF NOT EXISTS resend_domain_id  text UNIQUE,
  ADD COLUMN IF NOT EXISTS resend_status     text,
  ADD COLUMN IF NOT EXISTS resend_records    jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS resend_region     text,
  ADD COLUMN IF NOT EXISTS can_send          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_receive       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resend_checked_at timestamptz;

COMMENT ON COLUMN public.sending_domains.resend_status IS
  'Resend verification status: not_started | pending | verified | failed | temporary_failure.';

-- Verify:
--   SELECT domain, resend_status, can_send FROM public.sending_domains;
