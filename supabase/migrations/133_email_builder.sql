-- ============================================================
-- FFSA Hub — Email builder: saved templates + resend lineage
-- ============================================================
-- The Communications "emails" builder (formerly "campaigns" in the
-- UI) gains two capabilities that need schema:
--
--   1. Saved custom templates — a comms admin designs an email, then
--      saves its block layout as a reusable template that shows up in
--      the "start from" gallery alongside the code-defined presets.
--
--   2. Resend lineage — "Duplicate & resend" clones a sent email into
--      a fresh draft. resent_from_id records which email a copy came
--      from, so we can trace resends (and later offer "resend to
--      non-openers").
--
-- The email block layout itself lives in campaigns.body_source (jsonb),
-- so new block types / per-block styles need NO schema change — only
-- these two additive pieces do.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. email_templates — user-saved reusable layouts
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  tagline       text,
  -- A CampaignBody { blocks: [...] } — same shape as campaigns.body_source.
  body_source   jsonb NOT NULL,
  -- Optional preview image (brand-assets bucket).
  thumbnail_url text,
  created_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_templates IS
  'Reusable email layouts saved by comms admins; complements the code-defined starter presets in src/lib/campaigns/templates.ts.';

CREATE INDEX IF NOT EXISTS email_templates_created_at_idx
  ON public.email_templates (created_at DESC);

-- updated_at maintenance (shared trigger fn used across the schema).
DROP TRIGGER IF EXISTS set_email_templates_updated_at ON public.email_templates;
CREATE TRIGGER set_email_templates_updated_at
  BEFORE UPDATE ON public.email_templates
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

-- Any authenticated user may read templates (they only describe layout,
-- no recipient data); only admins / comms admins may manage them.
DROP POLICY IF EXISTS "Auth users can read email templates" ON public.email_templates;
CREATE POLICY "Auth users can read email templates"
  ON public.email_templates FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admins and comms can manage email templates" ON public.email_templates;
CREATE POLICY "Admins and comms can manage email templates"
  ON public.email_templates FOR ALL
  USING (public.is_admin() OR public.has_role('comms_admin'))
  WITH CHECK (public.is_admin() OR public.has_role('comms_admin'));

-- ────────────────────────────────────────────────────────────
-- 2. campaigns.resent_from_id — resend lineage (additive, nullable)
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS resent_from_id uuid
    REFERENCES public.campaigns(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.campaigns.resent_from_id IS
  'When this email was created via Duplicate & resend, the source email it was cloned from.';

-- ────────────────────────────────────────────────────────────
-- Validation (run after applying)
-- ────────────────────────────────────────────────────────────
-- SELECT COUNT(*) FROM public.email_templates;
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'campaigns' AND column_name = 'resent_from_id';
