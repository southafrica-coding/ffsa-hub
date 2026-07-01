-- ============================================================
-- FFSA Hub — Migration 119: events.brand += 'preachers'
-- ============================================================
-- Adds PREACHERS SA as a fourth event-level brand alongside Fire &
-- Fragrance ('ff'), THE SEND ('the_send') and FFSA Camps ('ffsa_camps').
-- The brand drives the visual identity of every surface tied to an
-- event: the public storefront + registration forms, workflow-step
-- emails, and ticket confirmations.
--
-- Four brands now:
--   - 'ff'         → Fire & Fragrance (black/gold, Roboto)
--   - 'the_send'   → THE SEND (navy/cream/gold, Arial Black, ticker)
--   - 'ffsa_camps' → FFSA Camps (bright blue + cream, heavy italic,
--                     "PERMISSION GRANTED")
--   - 'preachers'  → PREACHERS SA (DARK gunmetal navy #1B2A33 + aged
--                     bone #EDE6D3, condensed heavy caps, twin lightning
--                     bolts, "GO. PREACH." — strictly monochrome)
--
-- Migration 077 created the column with an inline CHECK, widened at 092
-- for ffsa_camps. We drop it and re-add it widened again.
--
-- This migration also seeds the 'preachers' sending identity so ticket
-- confirmation + workflow emails resolve their From: per-event by brand:
--   brand='ff'         → sending_identities.slug = 'events'
--   brand='the_send'   → sending_identities.slug = 'the-send'
--   brand='ffsa_camps' → sending_identities.slug = 'ffsa-camps'
--   brand='preachers'  → sending_identities.slug = 'preachers'
-- preachers@ffsahub.com sits on the already-verified ffsahub.com domain.
-- Admins can edit display_name / from_name / reply_to from
-- /communications/identities without a deploy.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + ON CONFLICT (slug) DO NOTHING,
-- so this is safe to re-run. No backfill — existing rows keep their brand.
-- ============================================================

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_brand_check;

ALTER TABLE public.events
  ADD CONSTRAINT events_brand_check
    CHECK (brand IN ('ff', 'the_send', 'ffsa_camps', 'preachers'));

COMMENT ON COLUMN public.events.brand IS
  'Visual brand for every email + public surface tied to this event. ''ff'' = Fire & Fragrance; ''the_send'' = THE SEND bespoke shell; ''ffsa_camps'' = FFSA Camps bespoke shell; ''preachers'' = PREACHERS SA bespoke shell.';

INSERT INTO public.sending_identities (slug, display_name, from_email, from_name, reply_to, provider, is_active)
VALUES
  ('preachers', 'PREACHERS SA', 'preachers@ffsahub.com', 'PREACHERS SA', 'hello@ffsahub.com', 'mailtrap', true)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   -- Constraint should now accept the new value:
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'public.events'::regclass AND conname = 'events_brand_check';
--   -- expect: CHECK (brand IN ('ff', 'the_send', 'ffsa_camps', 'preachers'))
--
--   SELECT slug, from_name, from_email, reply_to
--   FROM public.sending_identities
--   WHERE slug IN ('events', 'the-send', 'ffsa-camps', 'preachers');
--   -- expect 4 rows
-- ============================================================
