-- ============================================================
-- FFSA Hub — Migration 190: Org chart — correct two name spellings
-- ============================================================
-- The 099 seed misspelled both Finance team members:
--   fin-coreen  "Coreen Styn"  →  "Coreen Steyn"
--   fin-ellen   "Ellen Styn"   →  "Ellen Stines"
-- (They are not related — the shared "Styn" in the seed was the error.)
--
-- Idempotent: each update is keyed on the stable node key and the
-- old label, so re-running after the fix is a no-op.
-- ============================================================

UPDATE public.org_nodes
   SET label      = 'Coreen Steyn',
       updated_at = now()
 WHERE key = 'fin-coreen'
   AND label = 'Coreen Styn';

UPDATE public.org_nodes
   SET label      = 'Ellen Stines',
       updated_at = now()
 WHERE key = 'fin-ellen'
   AND label = 'Ellen Styn';
