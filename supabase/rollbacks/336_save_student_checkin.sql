-- ============================================================
-- Rollback for 336_save_student_checkin.sql
-- ============================================================
-- DRAFT. Drops only the function 336 created. Check-ins already saved
-- stay in student_checkins / student_checkin_private (334).
-- ============================================================

DROP FUNCTION IF EXISTS public.save_student_checkin(uuid, date, text, text, text, text, boolean);
