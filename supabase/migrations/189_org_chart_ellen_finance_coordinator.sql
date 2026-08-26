-- ============================================================
-- FFSA Hub — Migration 189: Org chart — Ellen's title update
-- ============================================================
-- Ellen's role on the org chart moves from "Finance Clerk" to
-- "Finance Coordinator". The seed in 099 hard-coded the old title;
-- this updates the live row in place, preserving the "(under Coreen)"
-- qualifier if it is still there.
--
-- Idempotent: matches on the stable node key and only rewrites the
-- "Finance Clerk" portion of the subtitle.
-- ============================================================

UPDATE public.org_nodes
   SET subtitle   = replace(subtitle, 'Finance Clerk', 'Finance Coordinator'),
       updated_at = now()
 WHERE key = 'fin-ellen'
   AND subtitle LIKE '%Finance Clerk%';
