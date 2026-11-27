-- DO NOT APPLY until Jack says so. Apply after 500 (embassies).
-- ============================================================
-- FFSA Hub — Migration 501: visa applications (review follow-ups)
-- ============================================================
-- Jack's review notes on #714 (366) and #724 (500), 25 Nov 2026:
--
--   1. PASSPORT NUMBERS, HOWEVER THEY'RE TYPED. visa_text_has_passport
--      now compares letters and digits only: both the text and the number
--      are upper-cased and stripped to [A-Z0-9], so a non-breaking space,
--      hyphens, dots or zero-width characters inside the number no longer
--      hide it. Any non-empty number counts, however short. It guards the
--      letter text and inputs, the student's note and legal's withdraw note
--      (366).
--   2. TEMPLATES. visa_save_letter_template refuses a title, body or
--      change note holding any student's passport number (a pasted real
--      letter, say). A template isn't about one case, so this checks every
--      passport number on file; numbers under 5 letters and digits are
--      skipped there, because in a whole letter they match ordinary text
--      (dates, years) and can't be told apart.
--   3. WHO OPENED FFSA'S DOCUMENTS. Every open of a standing document is
--      recorded in visa_standing_document_events, legal's opens too (500
--      only logged a student's, on their case). A student's download is
--      still logged on the case as well.
--
-- One transaction. Additive: one new table, replaced functions with the
-- same signatures. Idempotent.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. NORMALISING
-- ────────────────────────────────────────────────────────────
-- Letters and digits only, upper case. Internal.
CREATE OR REPLACE FUNCTION public.visa_passport_key(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT regexp_replace(upper(coalesce(p_text, '')), '[^A-Z0-9]', '', 'g');
$$;

-- Does this text hold the case's passport number? (Replaces 366's.)
CREATE OR REPLACE FUNCTION public.visa_text_has_passport(p_case_id uuid, p_text text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_passport text;
BEGIN
  SELECT public.visa_passport_key(u.passport_number) INTO v_passport
    FROM public.visa_cases c JOIN public.users u ON u.id = c.user_id
   WHERE c.id = p_case_id;
  IF coalesce(v_passport, '') = '' OR p_text IS NULL THEN
    RETURN false;
  END IF;
  RETURN strpos(public.visa_passport_key(p_text), v_passport) > 0;
END;
$$;

-- Does this text hold anyone's passport number? For templates. Internal.
CREATE OR REPLACE FUNCTION public.visa_text_has_any_passport(p_text text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_text text := public.visa_passport_key(p_text);
BEGIN
  IF v_text = '' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
      FROM public.users u
     WHERE length(public.visa_passport_key(u.passport_number)) >= 5
       AND strpos(v_text, public.visa_passport_key(u.passport_number)) > 0
  );
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 2. TEMPLATES (replaces 366's visa_save_letter_template; the only
--    change is the passport check before saving)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.visa_save_letter_template(
  p_kind        text,
  p_program_id  uuid,
  p_title       text,
  p_body        text,
  p_change_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key   uuid := coalesce(p_program_id, '00000000-0000-0000-0000-000000000000'::uuid);
  v_id    uuid;
  v_next  integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.visa_is_legal() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('invitation', 'accommodation', 'student_status') THEN
    RAISE EXCEPTION 'Unknown letter' USING ERRCODE = 'P0001';
  END IF;
  IF p_kind = 'invitation' AND p_program_id IS NULL THEN
    RAISE EXCEPTION 'An invitation letter is for one school' USING ERRCODE = 'P0001';
  END IF;
  IF coalesce(btrim(p_title), '') = '' OR coalesce(btrim(p_body), '') = '' THEN
    RAISE EXCEPTION 'Give the letter a title and some text' USING ERRCODE = 'P0001';
  END IF;
  -- A template is for every student: no one's passport number in it.
  IF public.visa_text_has_any_passport(p_title)
     OR public.visa_text_has_any_passport(p_body)
     OR public.visa_text_has_any_passport(p_change_note) THEN
    RAISE EXCEPTION 'There''s a passport number in the letter. Use {{passport_number}} instead'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('visa_letter_template:' || p_kind || ':' || v_key::text));

  SELECT id INTO v_id
    FROM public.visa_letter_templates
   WHERE kind = p_kind
     AND coalesce(program_id, '00000000-0000-0000-0000-000000000000'::uuid) = v_key
     AND status = 'draft'
   FOR UPDATE;

  IF FOUND THEN
    UPDATE public.visa_letter_templates
       SET title = btrim(p_title), body = p_body, change_note = nullif(btrim(p_change_note), ''),
           created_by = auth.uid()
     WHERE id = v_id;
  ELSE
    SELECT coalesce(max(version), 0) + 1 INTO v_next
      FROM public.visa_letter_templates
     WHERE kind = p_kind
       AND coalesce(program_id, '00000000-0000-0000-0000-000000000000'::uuid) = v_key;
    INSERT INTO public.visa_letter_templates
      (kind, program_id, version, title, body, status, change_note, created_by)
    VALUES
      (p_kind, p_program_id, v_next, btrim(p_title), p_body, 'draft', nullif(btrim(p_change_note), ''), auth.uid())
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 3. WHO OPENED FFSA'S DOCUMENTS
-- ────────────────────────────────────────────────────────────
-- Append-only. case_id: the student's case for a student's download;
-- NULL when global legal opened it.
CREATE TABLE IF NOT EXISTS public.visa_standing_document_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid NOT NULL REFERENCES public.visa_standing_documents(id) ON DELETE RESTRICT,
  case_id      uuid REFERENCES public.visa_cases(id) ON DELETE RESTRICT,
  actor_id     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  kind         text NOT NULL CHECK (kind IN ('opened')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_visa_standing_document_events_document
  ON public.visa_standing_document_events (document_id, created_at DESC);

ALTER TABLE public.visa_standing_document_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.visa_standing_document_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.visa_standing_document_events TO authenticated;
-- service_role reads; nobody edits or deletes the record.
REVOKE ALL ON public.visa_standing_document_events FROM service_role;
GRANT SELECT, INSERT ON public.visa_standing_document_events TO service_role;

DROP POLICY IF EXISTS "Visa standing document events: legal read" ON public.visa_standing_document_events;
CREATE POLICY "Visa standing document events: legal read"
  ON public.visa_standing_document_events FOR SELECT TO authenticated
  USING (public.visa_is_legal());

-- Replaces 500's: the same rules, and every open is recorded.
CREATE OR REPLACE FUNCTION public.visa_standing_document_path(p_document_id uuid, p_case_id uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_d public.visa_standing_documents%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_d FROM public.visa_standing_documents WHERE id = p_document_id;
  IF NOT FOUND OR v_d.storage_path IS NULL THEN
    RAISE EXCEPTION 'Document not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_case_id IS NULL THEN
    IF NOT public.visa_is_legal() THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NOT public.visa_is_own_case(p_case_id)
       OR NOT EXISTS (SELECT 1 FROM public.visa_case_standing_documents(p_case_id) s WHERE s.id = p_document_id) THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
    PERFORM public.visa_log(p_case_id, 'standing_document_downloaded',
      jsonb_build_object('document_id', p_document_id, 'label', v_d.label));
  END IF;

  INSERT INTO public.visa_standing_document_events (document_id, case_id, actor_id, kind)
  VALUES (p_document_id, p_case_id, auth.uid(), 'opened');
  RETURN v_d.storage_path;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 4. GRANTS — the helpers are internal
-- ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.visa_passport_key(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.visa_text_has_passport(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.visa_text_has_any_passport(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.visa_save_letter_template(text, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visa_save_letter_template(text, uuid, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.visa_standing_document_path(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visa_standing_document_path(uuid, uuid) TO authenticated;

COMMIT;
