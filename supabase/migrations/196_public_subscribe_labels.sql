-- ============================================================
-- FFSA Hub — Migration 196: Public subscribe links per label
-- ============================================================
-- Lets a label be opened up as a public sign-up list, reachable
-- at /subscribe/<label slug>. The email builder drops a button
-- pointing at that page ("Subscribe" module), so a forwarded
-- newsletter can grow the list it came from.
--
-- Opt-in per label, not blanket: most labels are internal
-- segments (event outcomes, donor state) and must never be
-- self-joinable. Only labels flipped on here are public.
--
-- FFSA Family is enabled as the base list for updates and
-- newsletters.
-- ============================================================

ALTER TABLE public.labels
  ADD COLUMN IF NOT EXISTS public_subscribe boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.labels.public_subscribe IS
  'When true, anyone can join this label from /subscribe/<slug>. Off by default — internal segments must not be self-joinable.';

UPDATE public.labels
SET public_subscribe = true
WHERE slug = 'ffsa-family';

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   SELECT name, slug, public_subscribe FROM public.labels
--   WHERE public_subscribe;
--   -- expect exactly: FFSA Family | ffsa-family | t
-- ============================================================
