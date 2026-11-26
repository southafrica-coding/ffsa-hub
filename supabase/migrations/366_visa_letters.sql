-- DO NOT APPLY until Jack says so.
-- ============================================================
-- FFSA Hub — Migration 366: visa applications (letters)
-- ============================================================
-- Build step 3a. FFSA's letters for a student's visa application:
-- the invitation letter per school, the confirmation of accommodation and
-- the confirmation of student status.
--
--   1. Legal writes each letter as a TEMPLATE in the Hub. Every edit is a
--      new version; a version is a draft until legal publishes it, and a
--      published version never changes. The wording lives only in the
--      database, never in this repo (the repo is public).
--   2. On an approved case, legal ISSUES a letter from the current
--      template. The Hub fills in the student's details; nobody types
--      over the wording per case (legal's answers, 23 Nov 2026).
--   3. The STUDENT checks the details (name, dates, school) and confirms,
--      or says what's wrong, before anything is signed.
--   4. Legal prints it, SIGNS it by hand and STAMPS it, and uploads the
--      SCAN. No digital signature: several embassies refuse them. The
--      student downloads the signed scan.
--   A correction is a new letter that replaces the old one ("re-issue").
--
-- Passport numbers are never stored here (CLAUDE.md, Visas): an issued
-- letter keeps the token {{passport_number}} in its text, and the PDF route
-- fills it in at download time, for legal and the student only, through
-- visa_letter_passport(). The signed scan does show it, so it lives in the
-- private 'visa-documents' bucket like a passport scan, at
-- '<case id>/<letter id>.<ext>'.
--
-- The text of an issued letter is rendered by the API from the template
-- (src/lib/visas/letters.ts) and stored as issued, with the template
-- version and the values legal entered, so what was sent can always be
-- shown. visa_issue_letter checks that every field was filled in and that
-- the passport number isn't in the text.
--
-- Numbered 366: 364 and 365 are taken by open Vehicles PRs (#712, #713).
--
-- One transaction. Additive only: two new tables and new functions; no
-- existing table or function changes. Idempotent.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. LETTER TEMPLATES — kept by global legal, versioned
-- ────────────────────────────────────────────────────────────
-- kind: which letter. program_id: the school it's for; NULL = any school
-- (an invitation is always for one school). status: draft (being edited;
-- at most one per letter) → current (the one used; at most one) →
-- retired (replaced by a newer version).
CREATE TABLE IF NOT EXISTS public.visa_letter_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('invitation', 'accommodation', 'student_status')),
  program_id    uuid REFERENCES public.programs(id) ON DELETE RESTRICT,
  version       integer NOT NULL CHECK (version > 0),
  title         text NOT NULL CHECK (length(btrim(title)) > 0),
  body          text NOT NULL CHECK (length(btrim(body)) > 0),
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'current', 'retired')),
  change_note   text,
  created_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  published_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  published_at  timestamptz,
  CONSTRAINT visa_letter_templates_invitation_school CHECK (kind <> 'invitation' OR program_id IS NOT NULL),
  CONSTRAINT visa_letter_templates_published CHECK ((status = 'draft') = (published_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS visa_letter_templates_version
  ON public.visa_letter_templates (kind, coalesce(program_id, '00000000-0000-0000-0000-000000000000'::uuid), version);
CREATE UNIQUE INDEX IF NOT EXISTS visa_letter_templates_one_current
  ON public.visa_letter_templates (kind, coalesce(program_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'current';
CREATE UNIQUE INDEX IF NOT EXISTS visa_letter_templates_one_draft
  ON public.visa_letter_templates (kind, coalesce(program_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'draft';

DROP TRIGGER IF EXISTS set_updated_at ON public.visa_letter_templates;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.visa_letter_templates
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- A published version never changes; the only move left is current →
-- retired when a newer version is published.
CREATE OR REPLACE FUNCTION public.visa_letter_templates_locked()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.program_id IS DISTINCT FROM OLD.program_id
     OR NEW.version IS DISTINCT FROM OLD.version THEN
    RAISE EXCEPTION 'A template''s letter, school and version can''t change' USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'draft' AND (
       NEW.title IS DISTINCT FROM OLD.title
       OR NEW.body IS DISTINCT FROM OLD.body
       OR NEW.change_note IS DISTINCT FROM OLD.change_note
       OR NEW.published_at IS DISTINCT FROM OLD.published_at
       OR NOT (NEW.status = OLD.status OR (OLD.status = 'current' AND NEW.status = 'retired'))
     ) THEN
    RAISE EXCEPTION 'A published template can''t be changed; save a new version' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS visa_letter_templates_locked ON public.visa_letter_templates;
CREATE TRIGGER visa_letter_templates_locked BEFORE UPDATE ON public.visa_letter_templates
  FOR EACH ROW EXECUTE FUNCTION public.visa_letter_templates_locked();

-- ────────────────────────────────────────────────────────────
-- 2. LETTERS — one row per issued letter
-- ────────────────────────────────────────────────────────────
-- status:
--   with_student  issued; the student is checking the details
--   needs_fix     the student said something is wrong (student_note)
--   confirmed     the student confirmed; legal signs, stamps and scans it
--   signed        the scan is on the case; the student downloads it
--   replaced      a newer letter of the same kind replaced it
--   withdrawn     legal took it back
-- body: the letter as issued, every field filled in except
-- {{passport_number}}. inputs: what legal entered when issuing
-- (addressee, extra dates...), never a passport number.
CREATE TABLE IF NOT EXISTS public.visa_letters (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id           uuid NOT NULL REFERENCES public.visa_cases(id) ON DELETE RESTRICT,
  template_id       uuid NOT NULL REFERENCES public.visa_letter_templates(id) ON DELETE RESTRICT,
  kind              text NOT NULL CHECK (kind IN ('invitation', 'accommodation', 'student_status')),
  program_id        uuid REFERENCES public.programs(id) ON DELETE RESTRICT,
  letter_date       date NOT NULL,
  title             text NOT NULL,
  body              text NOT NULL CHECK (length(btrim(body)) > 0),
  inputs            jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            text NOT NULL DEFAULT 'with_student'
                    CHECK (status IN ('with_student', 'needs_fix', 'confirmed', 'signed', 'replaced', 'withdrawn')),
  replaces_id       uuid REFERENCES public.visa_letters(id) ON DELETE RESTRICT,
  student_note      text,
  confirmed_at      timestamptz,
  scan_path         text,
  scan_mime_type    text,
  scan_uploaded_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  scan_uploaded_at  timestamptz,
  status_note       text,
  issued_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- The scan is always '<this row's case_id>/<this row's id>.<ext>'.
  CONSTRAINT visa_letters_own_path CHECK (
    scan_path IS NULL
    OR scan_path ~ ('^' || case_id::text || '/' || id::text || '\.[a-z0-9]{2,5}$')
  ),
  CONSTRAINT visa_letters_signed_has_scan CHECK (status <> 'signed' OR scan_path IS NOT NULL)
);

-- One live letter of each kind per school on a case.
CREATE UNIQUE INDEX IF NOT EXISTS visa_letters_one_live
  ON public.visa_letters (case_id, kind, coalesce(program_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status NOT IN ('replaced', 'withdrawn');
CREATE INDEX IF NOT EXISTS idx_visa_letters_case ON public.visa_letters (case_id, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON public.visa_letters;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.visa_letters
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- What was issued never changes; a correction is a new letter. The scan
-- is set once.
CREATE OR REPLACE FUNCTION public.visa_letters_locked()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.case_id IS DISTINCT FROM OLD.case_id
     OR NEW.template_id IS DISTINCT FROM OLD.template_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.program_id IS DISTINCT FROM OLD.program_id
     OR NEW.letter_date IS DISTINCT FROM OLD.letter_date
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.inputs IS DISTINCT FROM OLD.inputs
     OR NEW.replaces_id IS DISTINCT FROM OLD.replaces_id
     OR NEW.issued_by IS DISTINCT FROM OLD.issued_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'An issued letter can''t be changed; issue a new one' USING ERRCODE = '42501';
  END IF;
  IF OLD.scan_path IS NOT NULL AND NEW.scan_path IS DISTINCT FROM OLD.scan_path THEN
    RAISE EXCEPTION 'A signed letter''s scan can''t be replaced; issue a new letter' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS visa_letters_locked ON public.visa_letters;
CREATE TRIGGER visa_letters_locked BEFORE UPDATE ON public.visa_letters
  FOR EACH ROW EXECUTE FUNCTION public.visa_letters_locked();

-- ────────────────────────────────────────────────────────────
-- 3. RLS AND GRANTS — read through RLS, write only through section 4
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.visa_letter_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visa_letters          ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.visa_letter_templates, public.visa_letters
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.visa_letter_templates, public.visa_letters TO authenticated;
GRANT ALL ON TABLE public.visa_letter_templates, public.visa_letters TO service_role;

-- Templates: anyone who holds visas.manage, global or scoped (a scoped
-- legal issues letters for their school from the same templates).
DROP POLICY IF EXISTS "Visa letter templates: legal read" ON public.visa_letter_templates;
CREATE POLICY "Visa letter templates: legal read"
  ON public.visa_letter_templates FOR SELECT TO authenticated
  USING (public.visa_is_legal() OR coalesce(public.has_permission('visas.manage'), false));

-- Letters: legal for the case, the case's school leaders (to see where
-- the letters are) and the student. The text holds no passport number;
-- the PDF and the scan are served by routes that let only legal and the
-- student open them.
DROP POLICY IF EXISTS "Visa letters: read" ON public.visa_letters;
CREATE POLICY "Visa letters: read"
  ON public.visa_letters FOR SELECT TO authenticated
  USING (
    public.visa_can_manage(case_id)
    OR public.visa_is_own_case(case_id)
    OR public.visa_can_follow_up(case_id)
  );

-- ────────────────────────────────────────────────────────────
-- 4. FUNCTIONS
-- ────────────────────────────────────────────────────────────

-- 4a. Templates (global legal only). Saving creates the next version as a
--     draft, or updates the draft that's already there.
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

  -- One writer at a time per letter, so two saves can't both make "the
  -- next version".
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

-- Publishing makes a draft the version that's used, and retires the one
-- before it. An invitation must carry FFSA's repatriation undertaking
-- (legal, 18 Nov 2026); the API checks the fields in full.
CREATE OR REPLACE FUNCTION public.visa_publish_letter_template(p_template_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_t public.visa_letter_templates%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.visa_is_legal() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_t FROM public.visa_letter_templates WHERE id = p_template_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_t.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft can be published' USING ERRCODE = 'P0001';
  END IF;
  IF v_t.kind = 'invitation' AND v_t.body !~* 'repatriat' THEN
    RAISE EXCEPTION 'An invitation letter must include FFSA''s repatriation undertaking' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.visa_letter_templates
     SET status = 'retired'
   WHERE kind = v_t.kind
     AND coalesce(program_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(v_t.program_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND status = 'current';
  UPDATE public.visa_letter_templates
     SET status = 'current', published_by = auth.uid(), published_at = now()
   WHERE id = p_template_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.visa_discard_letter_template_draft(p_template_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.visa_is_legal() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.visa_letter_templates WHERE id = p_template_id AND status = 'draft';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No draft to discard' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- 4b. The student's details for filling in a letter (legal for the case
--     only). No passport number: that is filled in at download time.
CREATE OR REPLACE FUNCTION public.visa_letter_student(p_case_id uuid)
RETURNS TABLE (first_name text, last_name text, gender text, nationality text, passport_country text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.visa_can_manage(p_case_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT u.first_name, u.last_name, u.gender, u.nationality, u.passport_country
      FROM public.visa_cases c
      JOIN public.users u ON u.id = c.user_id
     WHERE c.id = p_case_id;
END;
$$;

-- The passport number for a letter's PDF: legal for the case and the
-- student only, never school leaders. The route that calls it logs the
-- download.
CREATE OR REPLACE FUNCTION public.visa_letter_passport(p_letter_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_case uuid;
BEGIN
  SELECT case_id INTO v_case FROM public.visa_letters WHERE id = p_letter_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Letter not found' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() IS NULL OR NOT (public.visa_can_manage(v_case) OR public.visa_is_own_case(v_case)) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT u.passport_number
            FROM public.visa_cases c JOIN public.users u ON u.id = c.user_id
           WHERE c.id = v_case);
END;
$$;

-- While the case is approved and not yet lodged, who the letters wait on:
-- the student while any letter is with them, legal while any is waiting
-- for a fix or a signature, then the student again (to lodge).
CREATE OR REPLACE FUNCTION public.visa_refresh_letters_waiting_on(p_case_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.visa_cases c
     SET waiting_on = CASE
           WHEN EXISTS (SELECT 1 FROM public.visa_letters l
                         WHERE l.case_id = c.id AND l.status = 'with_student') THEN 'student'
           WHEN EXISTS (SELECT 1 FROM public.visa_letters l
                         WHERE l.case_id = c.id AND l.status IN ('needs_fix', 'confirmed')) THEN 'legal'
           ELSE 'student'
         END
   WHERE c.id = p_case_id
     AND c.status = 'approved';
$$;

-- Does this text hold the case's passport number? Case-insensitive, and
-- spaces inside the number don't hide it ("ab 123 456" matches AB123456).
-- Internal: the issue, check and withdraw functions call it so no
-- passport number lands in a letter, its inputs or a note leaders read.
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
  SELECT upper(regexp_replace(u.passport_number, '\s', '', 'g')) INTO v_passport
    FROM public.visa_cases c JOIN public.users u ON u.id = c.user_id
   WHERE c.id = p_case_id;
  IF v_passport IS NULL OR length(v_passport) < 5 OR p_text IS NULL THEN
    RETURN false;
  END IF;
  RETURN strpos(upper(regexp_replace(p_text, '\s', '', 'g')), v_passport) > 0;
END;
$$;

-- 4c. Legal issues a letter from the current template. The API renders
--     p_body from that template; a letter that replaces a live one of the
--     same kind and school marks the old one replaced.
CREATE OR REPLACE FUNCTION public.visa_issue_letter(
  p_case_id     uuid,
  p_template_id uuid,
  p_letter_date date,
  p_body        text,
  p_inputs      jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status   text;
  v_t        public.visa_letter_templates%ROWTYPE;
  v_old      uuid;
  v_id       uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.visa_can_manage(p_case_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF public.visa_is_own_case(p_case_id) THEN
    RAISE EXCEPTION 'You can''t act as staff on your own visa case' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_status FROM public.visa_cases WHERE id = p_case_id FOR UPDATE;
  -- After legal's approval; an exempt student may ask for a letter for the
  -- airport (legal, 23 Nov 2026).
  IF v_status IS NULL OR v_status NOT IN ('approved', 'lodged', 'granted', 'refused', 'arrived', 'exempt') THEN
    RAISE EXCEPTION 'Letters are issued once legal has approved the case' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_t FROM public.visa_letter_templates WHERE id = p_template_id;
  IF NOT FOUND OR v_t.status <> 'current' THEN
    RAISE EXCEPTION 'Use the current version of the letter' USING ERRCODE = 'P0001';
  END IF;
  IF v_t.program_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.visa_case_schools s
        WHERE s.case_id = p_case_id AND s.program_id = v_t.program_id) THEN
    RAISE EXCEPTION 'That letter is for a school this case doesn''t cover' USING ERRCODE = 'P0001';
  END IF;
  IF p_letter_date IS NULL THEN
    RAISE EXCEPTION 'Give the letter a date' USING ERRCODE = 'P0001';
  END IF;

  -- Every field filled in, except the passport number.
  IF coalesce(btrim(p_body), '') = ''
     OR replace(p_body, '{{passport_number}}', '') ~ '\{\{|\}\}' THEN
    RAISE EXCEPTION 'Some fields in the letter weren''t filled in' USING ERRCODE = 'P0001';
  END IF;
  -- The passport number never goes into the visa tables.
  IF public.visa_text_has_passport(p_case_id, p_body)
     OR public.visa_text_has_passport(p_case_id, coalesce(p_inputs, '{}'::jsonb)::text) THEN
    RAISE EXCEPTION 'The passport number is filled in when the letter is opened; leave it out of the text'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_old
    FROM public.visa_letters
   WHERE case_id = p_case_id
     AND kind = v_t.kind
     AND coalesce(program_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(v_t.program_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND status NOT IN ('replaced', 'withdrawn')
   FOR UPDATE;
  IF FOUND THEN
    UPDATE public.visa_letters SET status = 'replaced' WHERE id = v_old;
  END IF;

  INSERT INTO public.visa_letters
    (case_id, template_id, kind, program_id, letter_date, title, body, inputs, replaces_id, issued_by)
  VALUES
    (p_case_id, v_t.id, v_t.kind, v_t.program_id, p_letter_date, v_t.title, p_body,
     coalesce(p_inputs, '{}'::jsonb), v_old, auth.uid())
  RETURNING id INTO v_id;

  PERFORM public.visa_refresh_letters_waiting_on(p_case_id);
  PERFORM public.visa_log(p_case_id, 'letter_issued',
    jsonb_build_object('letter_id', v_id, 'kind', v_t.kind, 'template_version', v_t.version));
  RETURN v_id;
END;
$$;

-- 4d. The student checks the details: right, or what's wrong.
CREATE OR REPLACE FUNCTION public.visa_confirm_letter(p_letter_id uuid, p_ok boolean, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_l public.visa_letters%ROWTYPE;
BEGIN
  SELECT * INTO v_l FROM public.visa_letters WHERE id = p_letter_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Letter not found' USING ERRCODE = 'P0002';
  END IF;
  -- Only the student checks their own letter.
  IF auth.uid() IS NULL OR NOT public.visa_is_own_case(v_l.case_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF v_l.status <> 'with_student' THEN
    RAISE EXCEPTION 'This letter isn''t waiting for your check' USING ERRCODE = 'P0001';
  END IF;
  IF NOT p_ok AND coalesce(btrim(p_note), '') = '' THEN
    RAISE EXCEPTION 'Say what''s wrong' USING ERRCODE = 'P0001';
  END IF;
  -- Leaders can read the note, so no passport number in it.
  IF NOT p_ok AND public.visa_text_has_passport(v_l.case_id, p_note) THEN
    RAISE EXCEPTION 'Leave your passport number out of the note; legal already has it' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.visa_letters
     SET status = CASE WHEN p_ok THEN 'confirmed' ELSE 'needs_fix' END,
         student_note = CASE WHEN p_ok THEN NULL ELSE left(btrim(p_note), 2000) END,
         confirmed_at = CASE WHEN p_ok THEN now() ELSE NULL END
   WHERE id = p_letter_id;

  PERFORM public.visa_refresh_letters_waiting_on(v_l.case_id);
  PERFORM public.visa_log(v_l.case_id, CASE WHEN p_ok THEN 'letter_confirmed' ELSE 'letter_problem' END,
    jsonb_build_object('letter_id', p_letter_id, 'kind', v_l.kind));
END;
$$;

-- 4e. Legal adds the signed, stamped scan. The API has already stored it
--     at '<case id>/<letter id>.<ext>'; if this refuses, the API deletes it.
CREATE OR REPLACE FUNCTION public.visa_attach_letter_scan(p_letter_id uuid, p_scan_path text, p_mime_type text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_l public.visa_letters%ROWTYPE;
BEGIN
  SELECT * INTO v_l FROM public.visa_letters WHERE id = p_letter_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Letter not found' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() IS NULL OR NOT public.visa_can_manage(v_l.case_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF public.visa_is_own_case(v_l.case_id) THEN
    RAISE EXCEPTION 'You can''t act as staff on your own visa case' USING ERRCODE = '42501';
  END IF;
  IF v_l.status <> 'confirmed' THEN
    RAISE EXCEPTION 'The student has to confirm the details before the letter is signed' USING ERRCODE = 'P0001';
  END IF;
  IF p_scan_path IS DISTINCT FROM (v_l.case_id::text || '/' || p_letter_id::text || '.' || split_part(p_scan_path, '.', 2)) THEN
    RAISE EXCEPTION 'File path does not belong to this letter' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.visa_letters
     SET status = 'signed', scan_path = p_scan_path, scan_mime_type = p_mime_type,
         scan_uploaded_by = auth.uid(), scan_uploaded_at = now()
   WHERE id = p_letter_id;

  PERFORM public.visa_refresh_letters_waiting_on(v_l.case_id);
  PERFORM public.visa_log(v_l.case_id, 'letter_signed', jsonb_build_object('letter_id', p_letter_id, 'kind', v_l.kind));
END;
$$;

-- 4f. Legal takes a letter back (issued by mistake, say). A correction is
--     a re-issue instead, which keeps the link to the old letter.
CREATE OR REPLACE FUNCTION public.visa_withdraw_letter(p_letter_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_l public.visa_letters%ROWTYPE;
BEGIN
  SELECT * INTO v_l FROM public.visa_letters WHERE id = p_letter_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Letter not found' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() IS NULL OR NOT public.visa_can_manage(v_l.case_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF public.visa_is_own_case(v_l.case_id) THEN
    RAISE EXCEPTION 'You can''t act as staff on your own visa case' USING ERRCODE = '42501';
  END IF;
  IF v_l.status IN ('replaced', 'withdrawn') THEN
    RAISE EXCEPTION 'This letter is already %', v_l.status USING ERRCODE = 'P0001';
  END IF;
  IF coalesce(btrim(p_note), '') = '' THEN
    RAISE EXCEPTION 'Say why it''s withdrawn' USING ERRCODE = 'P0001';
  END IF;
  IF public.visa_text_has_passport(v_l.case_id, p_note) THEN
    RAISE EXCEPTION 'Leave the passport number out of the note' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.visa_letters
     SET status = 'withdrawn', status_note = left(btrim(p_note), 2000)
   WHERE id = p_letter_id;

  PERFORM public.visa_refresh_letters_waiting_on(v_l.case_id);
  PERFORM public.visa_log(v_l.case_id, 'letter_withdrawn', jsonb_build_object('letter_id', p_letter_id, 'kind', v_l.kind));
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 5. FUNCTION GRANTS — signed-in users only; each function checks the
--    caller. The waiting-on helper is internal.
-- ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.visa_refresh_letters_waiting_on(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.visa_text_has_passport(uuid, text) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.visa_save_letter_template(text, uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visa_publish_letter_template(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visa_discard_letter_template_draft(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visa_letter_student(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visa_letter_passport(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visa_issue_letter(uuid, uuid, date, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visa_confirm_letter(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visa_attach_letter_scan(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visa_withdraw_letter(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.visa_save_letter_template(text, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visa_publish_letter_template(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visa_discard_letter_template_draft(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visa_letter_student(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visa_letter_passport(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visa_issue_letter(uuid, uuid, date, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visa_confirm_letter(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visa_attach_letter_scan(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visa_withdraw_letter(uuid, text) TO authenticated;

COMMIT;
