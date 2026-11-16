-- ============================================================
-- FFSA Hub — Migration 190: Org chart — correct two name spellings
-- ============================================================
-- The 099 seed misspelled both Finance team members:
--   fin-sample2  "Sample Person 2"  →  "Sample Person 2"
--   fin-sample50   "Sample Person 50"   →  "Sample Person 50"
-- (They are not related — the shared "Styn" in the seed was the error.)
--
-- Idempotent: each update is keyed on the stable node key and the
-- old label, so re-running after the fix is a no-op.
-- ============================================================

UPDATE public.org_nodes
   SET label      = 'Sample Person 2',
       updated_at = now()
 WHERE key = 'fin-sample2'
   AND label = 'Sample Person 2';

UPDATE public.org_nodes
   SET label      = 'Sample Person 50',
       updated_at = now()
 WHERE key = 'fin-sample50'
   AND label = 'Sample Person 50';
