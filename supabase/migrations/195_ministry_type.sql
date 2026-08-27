-- ============================================================
-- FFSA Hub — Migration 195: Main vs Part-Time ministries
-- ------------------------------------------------------------
-- The Ministry tab lists every staff ministry in one flat list, with nothing
-- to separate the organisation's core teams from smaller, part-time efforts.
-- This adds a classification so the tab can group them.
--
-- DEFAULT 'main' types all existing rows as main in one step; Hope Again is
-- then flipped to part_time — the only part-time ministry today.
--
-- Part-time ministries keep rosters, leaders, point leaders, sub-categories
-- and OKRs — all unchanged. Two things read this column:
--   1. the Ministry tab, which groups rows under Main / Part-time headings
--   2. the Department picker, which offers MAIN ministries only (a department
--      is the main ministry someone serves in; part-time is roster-only)
-- Nothing about access or permissions keys off it.
--
-- Note: there is an unrelated okr_teams row also called 'Hope Again'
-- (migration 182) — a different table for OKR-only groups. Untouched here.
--
-- No RLS change needed: the existing "Admins manage staff ministries" ALL
-- policy (migration 126) already covers the new column. Idempotent.
-- ============================================================

ALTER TABLE public.staff_ministries
  ADD COLUMN IF NOT EXISTS ministry_type text NOT NULL DEFAULT 'main';

ALTER TABLE public.staff_ministries
  DROP CONSTRAINT IF EXISTS staff_ministries_ministry_type_check;

ALTER TABLE public.staff_ministries
  ADD CONSTRAINT staff_ministries_ministry_type_check
  CHECK (ministry_type IN ('main', 'part_time'));

COMMENT ON COLUMN public.staff_ministries.ministry_type IS
  'How the ministry is classified on the Ministry tab: ''main'' (a core FFSA '
  'ministry) or ''part_time'' (a smaller / part-time effort). Grouping and '
  'labelling only — no access, roster or OKR behaviour keys off this.';

UPDATE public.staff_ministries
   SET ministry_type = 'part_time'
 WHERE slug = 'hope_again';

-- ============================================================
-- Validation (run after applying) — expect 12 main + hope_again part_time:
--   SELECT ministry_type, count(*), string_agg(slug, ', ' ORDER BY slug)
--     FROM public.staff_ministries GROUP BY 1;
-- ============================================================
