-- ════════════════════════════════════════════════════════════
-- 245 — Donor statements (year-end giving statements, FF SA USA)
-- ════════════════════════════════════════════════════════════
-- Replaces finance's Google Apps Script. Once a year finance totals each
-- donor's US-dollar gifts to FF SA USA, INC (the 501(c)(3)) for a tax year,
-- reviews the list, and sends each donor a PDF statement.
--
-- Phase 1 (this migration): settings, and "runs" — a tax year's donations
-- pulled from the US Xero org or uploaded from a Xero report, kept as raw
-- invoice lines so the import rules can be re-applied when an option
-- changes. Phases 2–3 add the PDF, sending and the send log.
--
--   donor_statement_settings   — one row. Organisation details, signer,
--                                logo/signature paths, wording. The PDF and
--                                the email both read from here.
--   donor_statement_runs       — one per tax year attempt; source + options.
--   donor_statement_lines      — the invoice lines exactly as imported.
--   donor_statement_donor_edits— finance's fixes per donor in a run: email,
--                                name, include/exclude, merge into another.
--
-- Files (logo, signature, later the sent PDFs) live in the private
-- 'donor-statements' bucket. All reads and writes go through service-role
-- API routes gated on finance management or finance.donor_statements, so
-- RLS here only grants reads to the same people.
--
-- Idempotent. Safe to re-run.
-- ────────────────────────────────────────────────────────────

-- ── Permission ──────────────────────────────────────────────
INSERT INTO public.permissions (module, key, display_name, sort_order)
VALUES ('finance', 'finance.donor_statements', 'Prepare and send donor statements', 60)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.can_manage_donor_statements()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin()
      OR public.has_role('finance_admin')
      OR public.has_permission('finance.manage')
      OR public.has_permission('finance.write')
      OR public.has_permission('finance.donor_statements');
$$;

-- ── Settings (single row) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.donor_statement_settings (
  id                 boolean PRIMARY KEY DEFAULT true CHECK (id),
  org_name           text NOT NULL DEFAULT 'FF SA USA, INC',
  tax_id             text NOT NULL DEFAULT '99-1356564',
  address_line1      text NOT NULL DEFAULT 'C/O FF CHARLOTTE',
  address_line2      text NOT NULL DEFAULT '1324 THE PLAZA',
  address_city_line  text NOT NULL DEFAULT 'CHARLOTTE, NC 28205-3428',
  signer_name        text NOT NULL DEFAULT 'Allyson Tiglao',
  signer_title       text NOT NULL DEFAULT 'President',
  logo_path          text,
  signature_path     text,
  -- Which Xero lines count as donations.
  account_codes      text[] NOT NULL DEFAULT ARRAY['1010', '1012', '1013', '1080'],
  excluded_item_codes text[] NOT NULL DEFAULT ARRAY['STRIPE'],
  excluded_line_phrases text[] NOT NULL DEFAULT ARRAY['Stripe Card Processing Fee', '10% to FFSA'],
  -- Lines whose description contains one of these are flagged for review
  -- (the donor may have received something in return).
  review_line_phrases text[] NOT NULL DEFAULT ARRAY['Send Night', 'Fundraiser', 'Ticket', 'Event'],
  -- Donor names that look like organisations, flagged for review.
  organisation_phrases text[] NOT NULL DEFAULT ARRAY[
    'Charitable', 'School', 'Church', 'Foundation', 'Fund', 'Trust', 'Ministries',
    'Ministry', 'Inc', 'LLC', 'Ltd', 'Tech', 'Company', 'Corp'
  ],
  updated_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.donor_statement_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.donor_statement_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read donor statement settings" ON public.donor_statement_settings;
CREATE POLICY "Read donor statement settings"
  ON public.donor_statement_settings FOR SELECT
  USING (public.can_manage_donor_statements());

-- ── Runs ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.donor_statement_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_year          integer NOT NULL CHECK (tax_year BETWEEN 2020 AND 2100),
  source            text NOT NULL CHECK (source IN ('xero', 'upload')),
  source_file_name  text,
  -- { amountBasis: 'gross'|'net', includeNonUsd: bool, creditNotes: 'exclude'|'net' }
  options           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Contact name → email, from Xero contacts or an uploaded contacts sheet.
  contact_emails    jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'archived')),
  imported_at       timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dsr_year ON public.donor_statement_runs (tax_year, created_at DESC);

ALTER TABLE public.donor_statement_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read donor statement runs" ON public.donor_statement_runs;
CREATE POLICY "Read donor statement runs"
  ON public.donor_statement_runs FOR SELECT
  USING (public.can_manage_donor_statements());

-- ── Raw lines (one per invoice line, as imported) ──────────
CREATE TABLE IF NOT EXISTS public.donor_statement_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            uuid NOT NULL REFERENCES public.donor_statement_runs(id) ON DELETE CASCADE,
  position          integer NOT NULL,
  invoice_number    text NOT NULL,
  invoice_date      date,
  contact_name      text NOT NULL,
  contact_id        text,            -- Xero ContactID when pulled from the API
  email             text,            -- when the source row carries one
  item_code         text,
  description       text,
  account_code      text,
  quantity          numeric NOT NULL DEFAULT 1,
  unit_price_usd    numeric NOT NULL DEFAULT 0,   -- ex tax, converted to USD
  invoice_total_usd numeric,                      -- net of card fees; never summed per line
  currency          text NOT NULL DEFAULT 'USD',
  status            text NOT NULL DEFAULT 'PAID'  -- Xero status (PAID / AUTHORISED)
);

CREATE INDEX IF NOT EXISTS idx_dsl_run ON public.donor_statement_lines (run_id, position);

ALTER TABLE public.donor_statement_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read donor statement lines" ON public.donor_statement_lines;
CREATE POLICY "Read donor statement lines"
  ON public.donor_statement_lines FOR SELECT
  USING (public.can_manage_donor_statements());

-- ── Finance's per-donor fixes within a run ─────────────────
CREATE TABLE IF NOT EXISTS public.donor_statement_donor_edits (
  run_id          uuid NOT NULL REFERENCES public.donor_statement_runs(id) ON DELETE CASCADE,
  donor_key       text NOT NULL,
  email           text,
  display_name    text,
  excluded        boolean NOT NULL DEFAULT false,
  merge_into_key  text,
  note            text,
  updated_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, donor_key)
);

ALTER TABLE public.donor_statement_donor_edits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read donor statement edits" ON public.donor_statement_donor_edits;
CREATE POLICY "Read donor statement edits"
  ON public.donor_statement_donor_edits FOR SELECT
  USING (public.can_manage_donor_statements());

-- ── Storage bucket (logo, signature, sent PDFs) ────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'donor-statements',
  'donor-statements',
  false,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Verify:
--   SELECT key FROM public.permissions WHERE key = 'finance.donor_statements';
--   SELECT org_name, address_city_line FROM public.donor_statement_settings;
--   SELECT id, public FROM storage.buckets WHERE id = 'donor-statements';
-- ============================================================
