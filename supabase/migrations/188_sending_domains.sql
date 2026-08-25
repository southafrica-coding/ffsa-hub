-- ============================================================
-- FFSA Hub — Migration 188: sending domains, and what identities may do
-- ------------------------------------------------------------
-- Step 3 of the communications build (doc 11 §8). Nothing in the Hub
-- tracks whether the domains it sends from are actually authorised to
-- send — no SPF, DKIM or DMARC record is ever looked at. Mail either
-- lands or quietly does not, and there is no screen that says why.
--
-- sending_identities (042) already exists and stays as it is: slug,
-- display_name, from_email, from_name, reply_to, provider, is_active.
-- This adds the four things doc 11 asks for on top of it, and the
-- domains table underneath it.
--
-- ONE DELIBERATE DEPARTURE FROM DOC 11
-- ------------------------------------------------------------
-- Doc 11 §8 says "check hourly". This project is on Vercel Hobby, where
-- every cron must be once-per-day — a sub-daily entry fails the entire
-- production build, which it did once already (PR #197). So the check is
-- daily, plus an on-demand recheck button so nobody waits 24 hours to see
-- a DNS change land. Written down here because the next person to read
-- doc 11 will otherwise "fix" the schedule and break the build.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sending_domains (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain          text NOT NULL UNIQUE
                    CHECK (domain = lower(btrim(domain)) AND domain <> ''),
  -- NULL = never checked. Distinguished from false on purpose: "we do not
  -- know" and "we know it is broken" must not look alike, because the send
  -- guard blocks on the second and not the first.
  spf_ok          boolean,
  dkim_ok         boolean,
  dmarc_ok        boolean,
  -- The selector to look up: <selector>._domainkey.<domain>. Providers
  -- differ, so it is stored rather than guessed.
  dkim_selector   text,
  last_checked_at timestamptz,
  last_error      text,
  -- What to paste into DNS, captured at check time so the UI can show it
  -- with copy buttons without re-deriving it.
  expected_records jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sending_domains_stale
  ON public.sending_domains(last_checked_at NULLS FIRST);

ALTER TABLE public.sending_identities
  -- What this identity is for, in words a person choosing one can read.
  ADD COLUMN IF NOT EXISTS purpose        text,
  -- Which roles may send as this identity. Empty array = anyone who can
  -- send at all. Checked in the send path, not just hidden in a dropdown.
  ADD COLUMN IF NOT EXISTS allowed_roles  jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Doc 11: only the FFX identity may use the FFX mark.
  ADD COLUMN IF NOT EXISTS uses_ffx_mark  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS domain_id      uuid
    REFERENCES public.sending_domains(id) ON DELETE SET NULL;

-- ── Seed a domain row per distinct sending domain, and link them ──
-- Every row lands unchecked (all three flags NULL), which is honest: the
-- Hub has never verified any of them. The daily job fills them in.
INSERT INTO public.sending_domains (domain)
SELECT DISTINCT lower(btrim(split_part(from_email, '@', 2)))
FROM public.sending_identities
WHERE from_email LIKE '%@%'
  AND btrim(split_part(from_email, '@', 2)) <> ''
ON CONFLICT (domain) DO NOTHING;

UPDATE public.sending_identities si
SET domain_id = sd.id
FROM public.sending_domains sd
WHERE sd.domain = lower(btrim(split_part(si.from_email, '@', 2)))
  AND si.domain_id IS DISTINCT FROM sd.id;

ALTER TABLE public.sending_domains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Comms staff can read sending domains" ON public.sending_domains;
CREATE POLICY "Comms staff can read sending domains"
  ON public.sending_domains FOR SELECT
  USING (
    public.is_admin()
    OR public.has_permission('communications.view')
    OR public.has_permission('communications.send')
  );

DROP POLICY IF EXISTS "Comms admins can write sending domains" ON public.sending_domains;
CREATE POLICY "Comms admins can write sending domains"
  ON public.sending_domains FOR INSERT
  WITH CHECK (public.is_admin() OR public.has_permission('communications.manage_brand_kits'));

DROP POLICY IF EXISTS "Comms admins can update sending domains" ON public.sending_domains;
CREATE POLICY "Comms admins can update sending domains"
  ON public.sending_domains FOR UPDATE
  USING (public.is_admin() OR public.has_permission('communications.manage_brand_kits'))
  WITH CHECK (public.is_admin() OR public.has_permission('communications.manage_brand_kits'));

COMMENT ON TABLE public.sending_domains IS
  'Domains the Hub sends from, with their SPF/DKIM/DMARC state. NULL flags mean never checked, which is different from false. Checked daily (Vercel Hobby forbids sub-daily crons) plus on demand.';
COMMENT ON COLUMN public.sending_identities.allowed_roles IS
  'Roles permitted to send as this identity. [] means anyone who may send at all. Enforced in the send path, not only in the picker.';
