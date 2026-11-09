-- ============================================================
-- FFSA Hub — Migration 308: lock down 304 table grants
-- ============================================================
-- 304 created public.program_staff, public.application_staff_reviews,
-- and public.application_admin_notes with no GRANT or REVOKE. Supabase
-- default privileges then gave anon and authenticated ALL on those
-- tables, including TRUNCATE. Confirmed on the live database.
--
-- This takes everything away from anon, and TRUNCATE, REFERENCES, and
-- TRIGGER away from authenticated. Authenticated keeps SELECT, INSERT,
-- UPDATE, and DELETE; existing RLS still decides which rows. REVOKE is
-- safe to run more than once.
--
-- Apply by hand in the Supabase SQL editor. Not applied by this PR.
-- ============================================================

REVOKE ALL ON TABLE public.program_staff, public.application_staff_reviews, public.application_admin_notes FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.program_staff, public.application_staff_reviews, public.application_admin_notes FROM authenticated;
