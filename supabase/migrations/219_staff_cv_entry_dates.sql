-- ============================================================
-- FFSA Hub — Migration 219: Staff CV entry dates
-- ------------------------------------------------------------
-- Past involvement and training entries on the staff CV card
-- (migration 218) can now carry a start/end date — e.g. which YWAM/FF
-- school (DTS, SBS, ICI…) and when. Both columns are optional and
-- nullable: a still-ongoing entry can have a start date with no end,
-- and skill/other entries simply never set either.
-- ============================================================

ALTER TABLE public.staff_cv_entries ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE public.staff_cv_entries ADD COLUMN IF NOT EXISTS end_date date;

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'staff_cv_entries' AND column_name IN ('start_date', 'end_date');
-- ============================================================
