-- DO NOT APPLY until Jack says so. Apply after 366 (visa letters).
-- ============================================================
-- FFSA Hub — Migration 500: visa applications (embassies and FFSA's
-- standing documents)
-- ============================================================
-- Build step 3b. Visa migrations are numbered in the 500s from here on
-- (Jack, 24 Nov 2026); 360–366 keep their numbers.
--
--   1. EMBASSY PROFILES. One row per South African mission a student
--      can apply at: who letters are addressed to, the city, whether a
--      scanned letter is accepted or the original is needed, blank
--      passport pages, processing and appointment times, and legal's
--      notes. Reference data, no personal data: every signed-in user can
--      read it; global legal keeps it. A mission is retired, never
--      deleted, so old cases still show where they applied.
--   2. THE CASE'S EMBASSY. visa_cases.embassy_id, set through
--      visa_set_case_embassy(): the student until legal has approved,
--      legal for the case until the case is lodged. When it's set, the
--      letter form fills in the addressee and city from it.
--   3. FFSA'S STANDING DOCUMENTS. The papers that go with every
--      application (registration, NPO certificate, proof of address,
--      legal's certified ID...), with their certification or expiry
--      dates so the Hub can warn before they run out. Only global legal
--      sees the list. A document marked for_students can be downloaded
--      by a student whose case is approved or lodged, through
--      visa_standing_document_path(), and every download is logged on
--      the case. Files live in the private 'visa-documents' bucket at
--      'standing/<document id>.<ext>'.
--
-- The processing and appointment weeks are stored here; the lodge-by
-- date that uses them is worked out in step 4.
--
-- One transaction. Additive: two new tables, one new nullable column on
-- visa_cases, new functions. Idempotent.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. EMBASSIES
-- ────────────────────────────────────────────────────────────
-- country_iso: the country the mission is in (where the student applies,
-- not necessarily their nationality). addressee: how letters open, e.g.
-- "The High Commissioner". accepts_scan / needs_original: NULL = not
-- known yet.
CREATE TABLE IF NOT EXISTS public.visa_embassies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso        text NOT NULL CHECK (country_iso ~ '^[A-Z]{2}$'),
  name               text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  city               text NOT NULL CHECK (length(btrim(city)) BETWEEN 1 AND 100),
  addressee          text CHECK (addressee IS NULL OR length(btrim(addressee)) BETWEEN 1 AND 200),
  accepts_scan       boolean,
  needs_original     boolean,
  blank_pages        integer CHECK (blank_pages IS NULL OR blank_pages BETWEEN 0 AND 10),
  processing_weeks   integer CHECK (processing_weeks IS NULL OR processing_weeks BETWEEN 1 AND 52),
  appointment_weeks  integer CHECK (appointment_weeks IS NULL OR appointment_weeks BETWEEN 0 AND 26),
  website_url        text CHECK (website_url IS NULL OR website_url ~ '^https://[^\s]+$'),
  notes              text CHECK (notes IS NULL OR length(notes) <= 4000),
  is_active          boolean NOT NULL DEFAULT true,
  updated_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS visa_embassies_one_per_name_city
  ON public.visa_embassies (country_iso, lower(btrim(name)), lower(btrim(city)));
CREATE INDEX IF NOT EXISTS idx_visa_embassies_country ON public.visa_embassies (country_iso);

DROP TRIGGER IF EXISTS set_updated_at ON public.visa_embassies;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.visa_embassies
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ────────────────────────────────────────────────────────────
-- 2. THE CASE'S EMBASSY
-- ────────────────────────────────────────────────────────────
-- RESTRICT: embassies are retired, not deleted.
ALTER TABLE public.visa_cases
  ADD COLUMN IF NOT EXISTS embassy_id uuid REFERENCES public.visa_embassies(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_visa_cases_embassy ON public.visa_cases (embassy_id);

-- ────────────────────────────────────────────────────────────
-- 3. STANDING DOCUMENTS
-- ────────────────────────────────────────────────────────────
-- certified_on + renew_months: a certified copy that has to be
-- re-certified every few months. expires_on: a document with its own
-- expiry date. Either, both or neither (a registration certificate
-- doesn't run out).
CREATE TABLE IF NOT EXISTS public.visa_standing_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label             text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 200),
  description       text CHECK (description IS NULL OR length(description) <= 2000),
  certified_on      date,
  renew_months      integer CHECK (renew_months IS NULL OR renew_months BETWEEN 1 AND 60),
  expires_on        date,
  for_students      boolean NOT NULL DEFAULT false,
  sort_order        integer NOT NULL DEFAULT 0,
  is_active         boolean NOT NULL DEFAULT true,
  storage_path      text,
  mime_type         text CHECK (mime_type IS NULL OR mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  file_uploaded_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  file_uploaded_at  timestamptz,
  updated_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- The file sits at the row's own path, so one row can't point at
  -- another's file or at a student's.
  CONSTRAINT visa_standing_documents_own_path CHECK (
    storage_path IS NULL
    OR storage_path = 'standing/' || id::text || '.pdf'
    OR storage_path = 'standing/' || id::text || '.jpg'
    OR storage_path = 'standing/' || id::text || '.png'
  ),
  CONSTRAINT visa_standing_documents_file_whole CHECK ((storage_path IS NULL) = (mime_type IS NULL)),
  -- A document students download must have a file.
  CONSTRAINT visa_standing_documents_students_need_file CHECK (NOT for_students OR storage_path IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS visa_standing_documents_label
  ON public.visa_standing_documents (lower(btrim(label)));

DROP TRIGGER IF EXISTS set_updated_at ON public.visa_standing_documents;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.visa_standing_documents
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ────────────────────────────────────────────────────────────
-- 4. RLS AND TABLE GRANTS
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.visa_embassies          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visa_standing_documents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.visa_embassies, public.visa_standing_documents FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.visa_embassies, public.visa_standing_documents TO authenticated;
GRANT ALL ON public.visa_embassies, public.visa_standing_documents TO service_role;

-- 4a. Embassies: reference data. Everyone signed in reads (the student
--     picks where they apply); global legal adds and edits. No DELETE
--     policy: retire with is_active.
DROP POLICY IF EXISTS "Visa embassies: signed-in read" ON public.visa_embassies;
CREATE POLICY "Visa embassies: signed-in read"
  ON public.visa_embassies FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS "Visa embassies: legal insert" ON public.visa_embassies;
CREATE POLICY "Visa embassies: legal insert"
  ON public.visa_embassies FOR INSERT TO authenticated
  WITH CHECK (public.visa_is_legal());
DROP POLICY IF EXISTS "Visa embassies: legal update" ON public.visa_embassies;
CREATE POLICY "Visa embassies: legal update"
  ON public.visa_embassies FOR UPDATE TO authenticated
  USING (public.visa_is_legal()) WITH CHECK (public.visa_is_legal());

-- 4b. Standing documents: global legal only. They include legal's own
--     certified ID, so not even legal scoped to one school reads the
--     list; students reach the ones marked for them through the
--     functions below.
DROP POLICY IF EXISTS "Visa standing documents: legal read" ON public.visa_standing_documents;
CREATE POLICY "Visa standing documents: legal read"
  ON public.visa_standing_documents FOR SELECT TO authenticated
  USING (public.visa_is_legal());
DROP POLICY IF EXISTS "Visa standing documents: legal insert" ON public.visa_standing_documents;
CREATE POLICY "Visa standing documents: legal insert"
  ON public.visa_standing_documents FOR INSERT TO authenticated
  WITH CHECK (public.visa_is_legal());
DROP POLICY IF EXISTS "Visa standing documents: legal update" ON public.visa_standing_documents;
CREATE POLICY "Visa standing documents: legal update"
  ON public.visa_standing_documents FOR UPDATE TO authenticated
  USING (public.visa_is_legal()) WITH CHECK (public.visa_is_legal());

-- ────────────────────────────────────────────────────────────
-- 5. FUNCTIONS
-- ────────────────────────────────────────────────────────────
-- 5a. Set (or clear, with NULL) where a case is lodged. The student
--     chooses until legal has approved; legal for the case can change it
--     until it's lodged (and re-issues any letter whose addressee is now
--     wrong).
CREATE OR REPLACE FUNCTION public.visa_set_case_embassy(p_case_id uuid, p_embassy_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text;
  v_own    boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_status FROM public.visa_cases WHERE id = p_case_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case not found' USING ERRCODE = 'P0002';
  END IF;
  v_own := public.visa_is_own_case(p_case_id);

  IF v_own THEN
    IF v_status NOT IN ('collecting_documents', 'sent_back', 'awaiting_legal') THEN
      RAISE EXCEPTION 'Legal has approved your case; ask legal to change the embassy' USING ERRCODE = 'P0001';
    END IF;
  ELSIF public.visa_can_manage(p_case_id) THEN
    IF v_status NOT IN ('collecting_documents', 'sent_back', 'awaiting_legal', 'approved') THEN
      RAISE EXCEPTION 'The embassy can''t change once the case is lodged' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  IF p_embassy_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.visa_embassies WHERE id = p_embassy_id AND is_active) THEN
    RAISE EXCEPTION 'Pick an embassy from the list' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.visa_cases SET embassy_id = p_embassy_id WHERE id = p_case_id;
  PERFORM public.visa_log(p_case_id, 'embassy_set', jsonb_build_object('embassy_id', p_embassy_id));
END;
$$;

-- 5b. The standing documents a student may download for their case:
--     only those marked for students, once legal has approved the case
--     and until it's lodged.
CREATE OR REPLACE FUNCTION public.visa_case_standing_documents(p_case_id uuid)
RETURNS TABLE (id uuid, label text, description text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.visa_is_own_case(p_case_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT d.id, d.label, d.description
      FROM public.visa_standing_documents d
      JOIN public.visa_cases c ON c.id = p_case_id
     WHERE c.status IN ('approved', 'lodged')
       AND d.is_active AND d.for_students AND d.storage_path IS NOT NULL
     ORDER BY d.sort_order, d.label;
END;
$$;

-- 5c. Where a standing document's file is, for a short-lived link. Global
--     legal: any document. A student: only as 5b allows, named by their
--     case, and the download is logged on that case.
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
    RETURN v_d.storage_path;
  END IF;

  IF NOT public.visa_is_own_case(p_case_id)
     OR NOT EXISTS (SELECT 1 FROM public.visa_case_standing_documents(p_case_id) s WHERE s.id = p_document_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  PERFORM public.visa_log(p_case_id, 'standing_document_downloaded',
    jsonb_build_object('document_id', p_document_id, 'label', v_d.label));
  RETURN v_d.storage_path;
END;
$$;

REVOKE ALL ON FUNCTION public.visa_set_case_embassy(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visa_case_standing_documents(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visa_standing_document_path(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visa_set_case_embassy(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visa_case_standing_documents(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visa_standing_document_path(uuid, uuid) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 6. SEED — the standing documents FFSA sends today, without files or
--    dates. Labels only; legal uploads the files and edits the list in
--    the Hub. Students get none until legal ticks "students get this".
-- ────────────────────────────────────────────────────────────
INSERT INTO public.visa_standing_documents (label, description, sort_order)
SELECT v.label, v.description, v.sort_order
  FROM (VALUES
    ('Company registration (CIPC)', 'FFSA''s registration certificate.', 10),
    ('NPO certificate', 'FFSA''s non-profit organisation registration.', 20),
    ('Accreditation certificate', 'The global accreditation of FFSA''s schools.', 30),
    ('Proof of address', 'A recent utility bill or the lease for the base.', 40),
    ('Operating location letter', 'The letter confirming where FFSA operates.', 50),
    ('Certified copy of legal''s ID', 'Proof of the host''s legal status. Re-certify regularly.', 60)
  ) AS v(label, description, sort_order)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.visa_standing_documents d WHERE lower(btrim(d.label)) = lower(btrim(v.label))
 );

COMMIT;
