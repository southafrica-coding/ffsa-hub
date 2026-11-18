-- ============================================================
-- FFSA Hub — Migration 336: save a weekly check-in in one step
-- ============================================================
-- The phone's check-in form (redesign 48d, prompt T3) writes a
-- student_checkins row and, optionally, its staff-only note in
-- student_checkin_private (both from migration 334). This function does
-- both in one transaction so a check-in can never be saved without its
-- note, or the other way round.
--
-- SECURITY INVOKER: every read and write runs as the caller, so the 334
-- RLS policies and guard trigger decide exactly as they would for two
-- separate writes. Nothing here widens access.
--
-- One row per author per student per week: saving again in the same week
-- updates it. An empty staff-only note deletes the private row.
-- Returns the check-in id, and whether this save newly raised
-- "needs care" (so the API knows when to tell the school leader).
--
-- Idempotent. Apply by hand in the Supabase SQL editor.
-- Rollback: supabase/rollbacks/336_save_student_checkin.sql.
-- ============================================================

CREATE OR REPLACE FUNCTION public.save_student_checkin(
  p_enrollment_id     uuid,
  p_week_of           date,
  p_contact           text,
  p_mood              text,
  p_note_for_student  text,
  p_note_staff_only   text,
  p_needs_care        boolean
)
RETURNS TABLE (checkin_id uuid, newly_needs_care boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id        uuid;
  v_was_care  boolean;
  v_student   text := NULLIF(btrim(coalesce(p_note_for_student, '')), '');
  v_staff     text := NULLIF(btrim(coalesce(p_note_staff_only, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'save_student_checkin: sign in first' USING ERRCODE = '42501';
  END IF;

  SELECT c.id, c.needs_care INTO v_id, v_was_care
  FROM public.student_checkins c
  WHERE c.enrollment_id = p_enrollment_id
    AND c.week_of = p_week_of
    AND c.by_user_id = auth.uid();

  IF v_id IS NULL THEN
    INSERT INTO public.student_checkins
      (enrollment_id, week_of, by_user_id, contact, mood, note_for_student, needs_care)
    VALUES
      (p_enrollment_id, p_week_of, auth.uid(), p_contact,
       CASE WHEN p_contact = 'no_reach' THEN NULL ELSE p_mood END,
       v_student, coalesce(p_needs_care, false))
    RETURNING id INTO v_id;
    v_was_care := false;
  ELSE
    UPDATE public.student_checkins
       SET contact = p_contact,
           mood = CASE WHEN p_contact = 'no_reach' THEN NULL ELSE p_mood END,
           note_for_student = v_student,
           needs_care = coalesce(p_needs_care, false)
     WHERE id = v_id;
  END IF;

  IF v_staff IS NULL THEN
    DELETE FROM public.student_checkin_private WHERE student_checkin_private.checkin_id = v_id;
  ELSE
    INSERT INTO public.student_checkin_private (checkin_id, note_staff_only)
    VALUES (v_id, v_staff)
    ON CONFLICT ON CONSTRAINT student_checkin_private_pkey
      DO UPDATE SET note_staff_only = EXCLUDED.note_staff_only;
  END IF;

  RETURN QUERY SELECT v_id, (coalesce(p_needs_care, false) AND NOT coalesce(v_was_care, false));
END;
$$;

REVOKE ALL ON FUNCTION public.save_student_checkin(uuid, date, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_student_checkin(uuid, date, text, text, text, text, boolean) TO authenticated, service_role;
