-- DO NOT APPLY until Jack says so.
-- ============================================================
-- FFSA Hub — Migration 363: visa applications (workflow functions)
-- ============================================================
-- Build step 2. Every move a student or school leader makes on a case goes
-- through one of these SECURITY DEFINER functions, which check who is
-- calling and where the case is before changing anything and append to the
-- event log. Users can't write the case tables directly at all (section 9):
-- every change, legal's included, goes through these functions, so the
-- two-person rule and the status order can't be skipped.
--
-- Nobody acts as staff on their own case: a leader or legal who is also
-- the student on a case can upload and tick for it like any student, but
-- can't review, request, decide, ask, answer, record progress or close.
--
--   Student (own case)        visa_add_document, visa_tick_offline
--   School leader / legal     visa_review_document, visa_request_approval,
--                             visa_ask_legal, visa_record_progress
--   Legal for the case        visa_decide, visa_answer_question,
--                             visa_close_case
--
-- "School leader" = visas.follow_up for a program on the case
-- (visa_can_follow_up). "Legal" = visa_can_manage (global visas.manage,
-- or visas.manage scoped to a program on the case).
--
-- Files: the API uploads to the private bucket at
-- '<case id>/<document id>.<ext>' with the service role, then calls
-- visa_add_document as the user with that document id. If the call is
-- refused, the API deletes the file.
--
-- Event detail never holds a passport number, a file name or a note's text
-- beyond what the case already shows.
--
-- One transaction. New functions, and it takes users' direct INSERT /
-- UPDATE on the case tables away (361 gave them to legal for step 1).
-- Idempotent (CREATE OR REPLACE, DROP POLICY IF EXISTS, REVOKE).
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. INTERNAL HELPERS (not granted to anyone but the functions' owner)
-- ────────────────────────────────────────────────────────────

-- The newest row per document type on a case; the one that counts.
CREATE OR REPLACE FUNCTION public.visa_latest_documents(p_case_id uuid)
RETURNS SETOF public.visa_case_documents
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT DISTINCT ON (d.document_type_id) d.*
    FROM public.visa_case_documents d
   WHERE d.case_id = p_case_id
   ORDER BY d.document_type_id, d.created_at DESC, d.id DESC;
$$;

-- Required, non-conditional document types still not approved or ticked.
-- Conditional types (e.g. yellow fever) are the leader's call and never
-- block a request. Up to 90 days uses the short list, beyond it the long.
CREATE OR REPLACE FUNCTION public.visa_missing_documents(p_case_id uuid)
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH c AS (
    SELECT (c.stay_to - c.stay_from + 1) > 90 AS long_stay
      FROM public.visa_cases c
     WHERE c.id = p_case_id
  )
  SELECT t.code
    FROM public.visa_document_types t, c
   WHERE t.is_active
     AND NOT t.is_conditional
     AND CASE WHEN c.long_stay THEN t.needed_over_90 ELSE t.needed_up_to_90 END
     AND NOT EXISTS (
       SELECT 1 FROM public.visa_latest_documents(p_case_id) d
        WHERE d.document_type_id = t.id
          AND d.status IN ('approved', 'ticked')
     )
   ORDER BY t.sort_order, t.code;
$$;

-- While documents are being collected, the case waits on the student until
-- nothing is missing or waiting for a redo, then on the school leader.
CREATE OR REPLACE FUNCTION public.visa_refresh_waiting_on(p_case_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.visa_cases c
     SET waiting_on = CASE
           WHEN EXISTS (
             SELECT 1
               FROM public.visa_document_types t
              WHERE t.is_active AND NOT t.is_conditional
                AND CASE WHEN (c.stay_to - c.stay_from + 1) > 90
                         THEN t.needed_over_90 ELSE t.needed_up_to_90 END
                AND NOT EXISTS (
                  SELECT 1 FROM public.visa_latest_documents(c.id) d
                   WHERE d.document_type_id = t.id
                     AND d.status IN ('uploaded', 'approved', 'ticked')
                )
           ) THEN 'student'
           ELSE 'school_leader'
         END
   WHERE c.id = p_case_id
     AND c.status IN ('collecting_documents', 'sent_back');
$$;

CREATE OR REPLACE FUNCTION public.visa_log(p_case_id uuid, p_kind text, p_detail jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.visa_case_events (case_id, actor_id, kind, detail)
  VALUES (p_case_id, auth.uid(), p_kind, coalesce(p_detail, '{}'::jsonb));
$$;

REVOKE ALL ON FUNCTION public.visa_latest_documents(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.visa_missing_documents(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.visa_refresh_waiting_on(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.visa_log(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.visa_latest_documents(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.visa_missing_documents(uuid) TO service_role;

-- Ready for approval? Callable by anyone who can see the case, so the
-- screens show the same list the request checks.
CREATE OR REPLACE FUNCTION public.visa_case_missing_documents(p_case_id uuid)
RETURNS SETOF text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT (public.visa_can_manage(p_case_id)
          OR public.visa_can_follow_up(p_case_id)
          OR public.visa_is_own_case(p_case_id)) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.visa_missing_documents(p_case_id);
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 2. STUDENT: upload a document / tick an offline step
-- ────────────────────────────────────────────────────────────
-- The student (or a leader or legal on their behalf) adds a file the API
-- has already put in the bucket. Allowed while documents are being
-- collected or after a send-back.
CREATE OR REPLACE FUNCTION public.visa_add_document(
  p_document_id      uuid,
  p_case_id          uuid,
  p_document_type_id uuid,
  p_storage_path     text,
  p_mime_type        text,
  p_size_bytes       integer,
  p_issued_on        date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text;
  v_type   public.visa_document_types%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.visa_is_own_case(p_case_id)
                                OR public.visa_can_follow_up(p_case_id)
                                OR public.visa_can_manage(p_case_id)) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_status FROM public.visa_cases WHERE id = p_case_id FOR UPDATE;
  IF v_status NOT IN ('collecting_documents', 'sent_back') THEN
    RAISE EXCEPTION 'Documents can''t be changed while the case is %', v_status USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_type FROM public.visa_document_types WHERE id = p_document_type_id;
  IF NOT FOUND OR NOT v_type.is_active THEN
    RAISE EXCEPTION 'Unknown document type' USING ERRCODE = 'P0001';
  END IF;
  IF v_type.is_offline THEN
    RAISE EXCEPTION '% is ticked off, not uploaded', v_type.label USING ERRCODE = 'P0001';
  END IF;
  IF p_storage_path IS DISTINCT FROM (p_case_id::text || '/' || p_document_id::text || '.' || split_part(p_storage_path, '.', 2)) THEN
    RAISE EXCEPTION 'File path does not belong to this document' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.visa_case_documents
    (id, case_id, document_type_id, storage_path, mime_type, size_bytes, issued_on, status, uploaded_by)
  VALUES
    (p_document_id, p_case_id, p_document_type_id, p_storage_path, p_mime_type, p_size_bytes, p_issued_on,
     'uploaded', auth.uid());

  PERFORM public.visa_refresh_waiting_on(p_case_id);
  PERFORM public.visa_log(p_case_id, 'document_uploaded', jsonb_build_object('document_type', v_type.code));
  RETURN p_document_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.visa_tick_offline(p_case_id uuid, p_document_type_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text;
  v_type   public.visa_document_types%ROWTYPE;
  v_id     uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.visa_is_own_case(p_case_id)
                                OR public.visa_can_follow_up(p_case_id)
                                OR public.visa_can_manage(p_case_id)) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_status FROM public.visa_cases WHERE id = p_case_id FOR UPDATE;
  IF v_status NOT IN ('collecting_documents', 'sent_back') THEN
    RAISE EXCEPTION 'Documents can''t be changed while the case is %', v_status USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_type FROM public.visa_document_types WHERE id = p_document_type_id;
  IF NOT FOUND OR NOT v_type.is_active OR NOT v_type.is_offline THEN
    RAISE EXCEPTION 'Only offline steps can be ticked' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.visa_latest_documents(p_case_id) d
              WHERE d.document_type_id = p_document_type_id AND d.status = 'ticked') THEN
    RAISE EXCEPTION '% is already ticked', v_type.label USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.visa_case_documents (case_id, document_type_id, status, uploaded_by)
  VALUES (p_case_id, p_document_type_id, 'ticked', auth.uid())
  RETURNING id INTO v_id;

  PERFORM public.visa_refresh_waiting_on(p_case_id);
  PERFORM public.visa_log(p_case_id, 'step_ticked', jsonb_build_object('document_type', v_type.code));
  RETURN v_id;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 3. SCHOOL LEADER: review a document
-- ────────────────────────────────────────────────────────────
-- Approve it, or ask for a redo with a note the student sees. Only the
-- newest upload of a type can be reviewed, once.
CREATE OR REPLACE FUNCTION public.visa_review_document(
  p_document_id uuid,
  p_approve     boolean,
  p_note        text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_doc    public.visa_case_documents%ROWTYPE;
  v_status text;
  v_code   text;
BEGIN
  SELECT * INTO v_doc FROM public.visa_case_documents WHERE id = p_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document not found' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() IS NULL OR NOT (public.visa_can_follow_up(v_doc.case_id)
                                OR public.visa_can_manage(v_doc.case_id)) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF public.visa_is_own_case(v_doc.case_id) THEN
    RAISE EXCEPTION 'You can''t act as staff on your own visa case' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_status FROM public.visa_cases WHERE id = v_doc.case_id FOR UPDATE;
  IF v_status NOT IN ('collecting_documents', 'sent_back') THEN
    RAISE EXCEPTION 'Documents can''t be reviewed while the case is %', v_status USING ERRCODE = 'P0001';
  END IF;
  IF v_doc.status <> 'uploaded' THEN
    RAISE EXCEPTION 'This document has already been reviewed' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.visa_latest_documents(v_doc.case_id) d WHERE d.id = p_document_id) THEN
    RAISE EXCEPTION 'A newer upload replaced this document' USING ERRCODE = 'P0001';
  END IF;
  IF NOT p_approve AND coalesce(btrim(p_note), '') = '' THEN
    RAISE EXCEPTION 'Say what needs redoing' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.visa_case_documents
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'needs_redo' END,
         review_note = nullif(btrim(p_note), ''),
         reviewed_by = auth.uid(),
         reviewed_at = now()
   WHERE id = p_document_id;

  SELECT code INTO v_code FROM public.visa_document_types WHERE id = v_doc.document_type_id;
  PERFORM public.visa_refresh_waiting_on(v_doc.case_id);
  PERFORM public.visa_log(v_doc.case_id,
    CASE WHEN p_approve THEN 'document_approved' ELSE 'document_needs_redo' END,
    jsonb_build_object('document_type', v_code));
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 4. SCHOOL LEADER: request legal's approval
-- ────────────────────────────────────────────────────────────
-- Only when the stay is known and every required document is approved or
-- ticked. Moves the case to awaiting_legal.
CREATE OR REPLACE FUNCTION public.visa_request_approval(p_case_id uuid, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_case    public.visa_cases%ROWTYPE;
  v_missing text[];
  v_id      uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.visa_can_follow_up(p_case_id)
                                OR public.visa_can_manage(p_case_id)) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF public.visa_is_own_case(p_case_id) THEN
    RAISE EXCEPTION 'You can''t act as staff on your own visa case' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_case FROM public.visa_cases WHERE id = p_case_id FOR UPDATE;
  IF v_case.status NOT IN ('collecting_documents', 'sent_back') THEN
    RAISE EXCEPTION 'Approval can''t be requested while the case is %', v_case.status USING ERRCODE = 'P0001';
  END IF;
  IF v_case.stay_from IS NULL OR v_case.stay_to IS NULL THEN
    RAISE EXCEPTION 'The stay dates aren''t set yet' USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(m) INTO v_missing FROM public.visa_missing_documents(p_case_id) m;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Still missing: %', array_to_string(v_missing, ', ') USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.visa_approval_requests (case_id, requested_by, leader_note)
  VALUES (p_case_id, auth.uid(), nullif(btrim(p_note), ''))
  RETURNING id INTO v_id;

  UPDATE public.visa_cases SET status = 'awaiting_legal', waiting_on = 'legal' WHERE id = p_case_id;
  PERFORM public.visa_log(p_case_id, 'approval_requested', '{}'::jsonb);
  RETURN v_id;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 5. LEGAL: approve, or send back with a note
-- ────────────────────────────────────────────────────────────
-- Approving here records the decision. Signing FFSA's letters with legal's
-- digital signature ("Approve and sign") arrives with the letters in step 3.
-- The person who sent the request never decides it.
CREATE OR REPLACE FUNCTION public.visa_decide(
  p_request_id uuid,
  p_approve    boolean,
  p_note       text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_req    public.visa_approval_requests%ROWTYPE;
  v_status text;
BEGIN
  SELECT * INTO v_req FROM public.visa_approval_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() IS NULL OR NOT public.visa_can_manage(v_req.case_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF public.visa_is_own_case(v_req.case_id) THEN
    RAISE EXCEPTION 'You can''t act as staff on your own visa case' USING ERRCODE = '42501';
  END IF;
  IF v_req.decision IS NOT NULL THEN
    RAISE EXCEPTION 'This request has already been decided' USING ERRCODE = 'P0001';
  END IF;
  -- Two people on every approval: whoever sent the request can't decide it,
  -- even when they also hold visas.manage (a backup approver, say).
  IF v_req.requested_by = auth.uid() THEN
    RAISE EXCEPTION 'Someone else has to decide a request you sent' USING ERRCODE = 'P0001';
  END IF;
  SELECT status INTO v_status FROM public.visa_cases WHERE id = v_req.case_id FOR UPDATE;
  IF v_status <> 'awaiting_legal' THEN
    RAISE EXCEPTION 'The case isn''t waiting for legal' USING ERRCODE = 'P0001';
  END IF;
  IF NOT p_approve AND coalesce(btrim(p_note), '') = '' THEN
    RAISE EXCEPTION 'Say what needs fixing' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.visa_approval_requests
     SET decision = CASE WHEN p_approve THEN 'approved' ELSE 'sent_back' END,
         decided_by = auth.uid(),
         decided_at = now(),
         legal_note = nullif(btrim(p_note), '')
   WHERE id = p_request_id;

  UPDATE public.visa_cases
     SET status     = CASE WHEN p_approve THEN 'approved' ELSE 'sent_back' END,
         waiting_on = CASE WHEN p_approve THEN 'student' ELSE 'school_leader' END
   WHERE id = v_req.case_id;

  PERFORM public.visa_log(v_req.case_id, CASE WHEN p_approve THEN 'approved' ELSE 'sent_back' END, '{}'::jsonb);
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 6. ASK LEGAL — serious questions only
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.visa_ask_legal(p_case_id uuid, p_question text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.visa_can_follow_up(p_case_id)
                                OR public.visa_can_manage(p_case_id)) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF public.visa_is_own_case(p_case_id) THEN
    RAISE EXCEPTION 'You can''t act as staff on your own visa case' USING ERRCODE = '42501';
  END IF;
  IF coalesce(btrim(p_question), '') = '' THEN
    RAISE EXCEPTION 'Write the question' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.visa_case_questions (case_id, asked_by, question)
  VALUES (p_case_id, auth.uid(), btrim(p_question))
  RETURNING id INTO v_id;
  PERFORM public.visa_log(p_case_id, 'question_asked', '{}'::jsonb);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.visa_answer_question(p_question_id uuid, p_answer text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_q public.visa_case_questions%ROWTYPE;
BEGIN
  SELECT * INTO v_q FROM public.visa_case_questions WHERE id = p_question_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Question not found' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() IS NULL OR NOT public.visa_can_manage(v_q.case_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF public.visa_is_own_case(v_q.case_id) THEN
    RAISE EXCEPTION 'You can''t act as staff on your own visa case' USING ERRCODE = '42501';
  END IF;
  IF v_q.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This question is already answered' USING ERRCODE = 'P0001';
  END IF;
  IF coalesce(btrim(p_answer), '') = '' THEN
    RAISE EXCEPTION 'Write the answer' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.visa_case_questions
     SET answer = btrim(p_answer), answered_by = auth.uid(), answered_at = now(), closed_at = now()
   WHERE id = p_question_id;
  PERFORM public.visa_log(v_q.case_id, 'question_answered', '{}'::jsonb);
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 7. PROGRESS AFTER APPROVAL — leaders and legal record what happened
-- ────────────────────────────────────────────────────────────
--   approved → lodged    (lodged_on, lodged_where, embassy_reference)
--   lodged   → granted   (decided_on, visa_valid_to)
--   lodged   → refused   (decided_on, refusal_reason)
--   granted / exempt → arrived (arrived_on, entry_stamp_ok)
-- Unknown keys in p_details are ignored.
CREATE OR REPLACE FUNCTION public.visa_record_progress(p_case_id uuid, p_status text, p_details jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_case public.visa_cases%ROWTYPE;
  d      jsonb := coalesce(p_details, '{}'::jsonb);
BEGIN
  IF auth.uid() IS NULL OR NOT (public.visa_can_follow_up(p_case_id)
                                OR public.visa_can_manage(p_case_id)) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF public.visa_is_own_case(p_case_id) THEN
    RAISE EXCEPTION 'You can''t act as staff on your own visa case' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_case FROM public.visa_cases WHERE id = p_case_id FOR UPDATE;

  IF p_status = 'lodged' AND v_case.status = 'approved' THEN
    IF (d->>'lodged_on') IS NULL THEN
      RAISE EXCEPTION 'Give the day it was lodged' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.visa_cases
       SET status = 'lodged', waiting_on = 'embassy',
           lodged_on = (d->>'lodged_on')::date,
           lodged_where = nullif(btrim(d->>'lodged_where'), ''),
           embassy_reference = nullif(btrim(d->>'embassy_reference'), '')
     WHERE id = p_case_id;
  ELSIF p_status = 'granted' AND v_case.status = 'lodged' THEN
    IF (d->>'visa_valid_to') IS NULL THEN
      RAISE EXCEPTION 'Give the last day the visa is valid' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.visa_cases
       SET status = 'granted', waiting_on = 'nobody',
           decided_on = coalesce((d->>'decided_on')::date, current_date),
           visa_valid_to = (d->>'visa_valid_to')::date
     WHERE id = p_case_id;
  ELSIF p_status = 'refused' AND v_case.status = 'lodged' THEN
    UPDATE public.visa_cases
       SET status = 'refused', waiting_on = 'legal',
           decided_on = coalesce((d->>'decided_on')::date, current_date),
           refusal_reason = nullif(btrim(d->>'refusal_reason'), '')
     WHERE id = p_case_id;
  ELSIF p_status = 'arrived' AND v_case.status IN ('granted', 'exempt') THEN
    IF (d->>'arrived_on') IS NULL OR (d->>'entry_stamp_ok') IS NULL THEN
      RAISE EXCEPTION 'Give the arrival day and whether the entry stamp is right' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.visa_cases
       SET status = 'arrived',
           waiting_on = CASE WHEN (d->>'entry_stamp_ok')::boolean THEN 'nobody' ELSE 'legal' END,
           arrived_on = (d->>'arrived_on')::date,
           entry_stamp_ok = (d->>'entry_stamp_ok')::boolean
     WHERE id = p_case_id;
  ELSE
    RAISE EXCEPTION 'A case that is % can''t move to %', v_case.status, p_status USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.visa_log(p_case_id, p_status, '{}'::jsonb);
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 8. LEGAL: close or withdraw a case
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.visa_close_case(p_case_id uuid, p_withdrawn boolean, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.visa_can_manage(p_case_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF public.visa_is_own_case(p_case_id) THEN
    RAISE EXCEPTION 'You can''t act as staff on your own visa case' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_status FROM public.visa_cases WHERE id = p_case_id FOR UPDATE;
  IF v_status IN ('closed', 'withdrawn') THEN
    RAISE EXCEPTION 'The case is already %', v_status USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.visa_cases
     SET status = CASE WHEN p_withdrawn THEN 'withdrawn' ELSE 'closed' END,
         waiting_on = 'nobody',
         closed_at = now()
   WHERE id = p_case_id;
  -- An undecided request can't outlive its case.
  UPDATE public.visa_approval_requests
     SET decision = 'sent_back', decided_by = auth.uid(), decided_at = now(),
         legal_note = coalesce(nullif(btrim(p_note), ''), 'Case closed')
   WHERE case_id = p_case_id AND decision IS NULL;
  PERFORM public.visa_log(p_case_id, CASE WHEN p_withdrawn THEN 'withdrawn' ELSE 'closed' END, '{}'::jsonb);
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 9. NO DIRECT WRITES — the case tables change only through the
--    functions above (which run as their owner) or the service role
-- ────────────────────────────────────────────────────────────
-- Without this, legal could UPDATE a request's decision or a case's
-- status directly and skip the two-person rule. Reading is unchanged.
-- Reference tables (country rules, document types) stay legal-editable.
REVOKE INSERT, UPDATE, DELETE ON TABLE
  public.visa_cases,
  public.visa_case_schools,
  public.visa_case_documents,
  public.visa_approval_requests,
  public.visa_case_questions
FROM authenticated;

DROP POLICY IF EXISTS "Visa cases: legal insert"              ON public.visa_cases;
DROP POLICY IF EXISTS "Visa cases: legal update"              ON public.visa_cases;
DROP POLICY IF EXISTS "Visa case schools: legal insert"       ON public.visa_case_schools;
DROP POLICY IF EXISTS "Visa case schools: legal update"       ON public.visa_case_schools;
DROP POLICY IF EXISTS "Visa case schools: legal delete"       ON public.visa_case_schools;
DROP POLICY IF EXISTS "Visa case documents: legal insert"     ON public.visa_case_documents;
DROP POLICY IF EXISTS "Visa case documents: legal update"     ON public.visa_case_documents;
DROP POLICY IF EXISTS "Visa approval requests: legal insert"  ON public.visa_approval_requests;
DROP POLICY IF EXISTS "Visa approval requests: legal update"  ON public.visa_approval_requests;
DROP POLICY IF EXISTS "Visa questions: legal insert"          ON public.visa_case_questions;
DROP POLICY IF EXISTS "Visa questions: legal update"          ON public.visa_case_questions;

-- ────────────────────────────────────────────────────────────
-- 10. GRANTS — signed-in users only; each function checks the caller
-- ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.visa_case_missing_documents(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visa_add_document(uuid, uuid, uuid, text, text, integer, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visa_tick_offline(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visa_review_document(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visa_request_approval(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visa_decide(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visa_ask_legal(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visa_answer_question(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visa_record_progress(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visa_close_case(uuid, boolean, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.visa_case_missing_documents(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.visa_add_document(uuid, uuid, uuid, text, text, integer, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visa_tick_offline(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visa_review_document(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visa_request_approval(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visa_decide(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visa_ask_legal(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visa_answer_question(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visa_record_progress(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visa_close_case(uuid, boolean, text) TO authenticated;

COMMIT;
