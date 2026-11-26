-- DO NOT APPLY until Jack says so.
-- ============================================================
-- FFSA Hub — Migration 361: visa applications (RLS, grants, bucket,
-- permission keys)
-- ============================================================
-- Who sees what:
--   * Legal (the visa officer): is_admin() or a GLOBAL visas.manage grant
--     sees and writes everything, including the reference tables. A
--     visas.manage grant scoped to a program manages only the cases that
--     cover that program (has_permission_for, as 312/313 do).
--   * School leaders: visas.follow_up, normally granted SCOPED to their
--     program (user_roles / user_permissions scope_type = 'program'). They
--     see a case only if it covers one of their programs, through
--     has_permission_for (040/089, made active-only in 313). An unscoped
--     visas.follow_up grant sees every school's cases — grant it scoped.
--   * Documents (legal's POPIA ruling, 23 Nov 2026): leaders see their
--     students' documents only while the case is open and the stay hasn't
--     ended. Police clearances and medical reports (is_restricted) are
--     special personal information: only global legal (the information
--     officer) and the student see them.
--   * Students: their own case, its schools and their own documents. Not
--     approval requests, questions or the event log (internal notes).
--   * Anyone else, and anon: nothing.
--
-- Build step 1 keeps writes narrow: only legal writes, directly. The
-- student upload, the leader's document review, "Request approval" and
-- "Ask legal" arrive in step 2 as SECURITY DEFINER functions that check
-- the actor and the case status, so no client can jump a case's status.
--
-- The 'visa-documents' bucket is private with NO storage.objects
-- policies, on purpose (same as evangelism uploads, 307): the API checks
-- access through the tables above, then signs a short-lived URL with the
-- service role.
--
-- One transaction: it applies whole or not at all.
-- Additive only. Idempotent: CREATE OR REPLACE, DROP POLICY IF EXISTS,
-- ON CONFLICT; REVOKE ALL before GRANT so re-running is clean.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. PERMISSION KEYS (no role gets them by default; grant per person)
-- ────────────────────────────────────────────────────────────
INSERT INTO public.permissions (module, key, display_name, sort_order) VALUES
  ('schools', 'visas.manage',    'Visas: approve, sign and manage everything (legal)', 90),
  ('schools', 'visas.follow_up', 'Visas: follow up students'' visas for a school', 91)
ON CONFLICT (key) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 2. HELPERS (definer, so they don't depend on the caller's visibility
--    of visa_cases / visa_case_schools — which would recurse)
-- ────────────────────────────────────────────────────────────
-- Global legal: an unscoped visas.manage grant. has_permission_for with a
-- NULL program matches only unscoped grants (scope_id = NULL is never true).
CREATE OR REPLACE FUNCTION public.visa_is_legal()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  -- coalesce: always a real true/false, so a NOT around it can't let a
  -- NULL through in the step-2 functions.
  SELECT coalesce(public.is_admin(), false)
      OR coalesce(public.has_permission_for('visas.manage', NULL), false);
$$;

-- Legal for one case: global legal, or visas.manage scoped to a program
-- the case covers.
CREATE OR REPLACE FUNCTION public.visa_can_manage(p_case_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.visa_is_legal()
      OR EXISTS (
        SELECT 1
          FROM public.visa_case_schools s
         WHERE s.case_id = p_case_id
           AND coalesce(public.has_permission_for('visas.manage', s.program_id), false)
      );
$$;

CREATE OR REPLACE FUNCTION public.visa_can_follow_up(p_case_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.visa_case_schools s
     WHERE s.case_id = p_case_id
       AND coalesce(public.has_permission_for('visas.follow_up', s.program_id), false)
  );
$$;

CREATE OR REPLACE FUNCTION public.visa_is_own_case(p_case_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.visa_cases c
        WHERE c.id = p_case_id AND c.user_id = auth.uid()
     );
$$;

-- A school leader sees a case's documents only while the case is open
-- and the stay hasn't ended (legal, 23 Nov 2026).
CREATE OR REPLACE FUNCTION public.visa_leader_can_see_documents(p_case_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.visa_can_follow_up(p_case_id)
     AND EXISTS (
       SELECT 1 FROM public.visa_cases c
        WHERE c.id = p_case_id
          AND c.status NOT IN ('closed', 'withdrawn')
          AND (c.stay_to IS NULL OR current_date <= c.stay_to)
     );
$$;

-- Police clearance, medical report: POPIA special personal information.
CREATE OR REPLACE FUNCTION public.visa_type_is_restricted(p_document_type_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce((SELECT t.is_restricted FROM public.visa_document_types t
                    WHERE t.id = p_document_type_id), true);
$$;

REVOKE ALL ON FUNCTION public.visa_is_legal() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visa_can_manage(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visa_can_follow_up(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visa_is_own_case(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visa_leader_can_see_documents(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visa_type_is_restricted(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visa_is_legal() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.visa_can_manage(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.visa_can_follow_up(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.visa_is_own_case(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.visa_leader_can_see_documents(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.visa_type_is_restricted(uuid) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 3. ENABLE RLS
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.visa_country_rules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visa_document_types     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visa_cases              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visa_case_schools       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visa_case_documents     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visa_approval_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visa_case_questions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visa_case_events        ENABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────
-- 4. GRANTS — table privileges; RLS below decides which rows.
--    service_role is named in the REVOKE on purpose (see 307): Supabase's
--    default ACL grants it ALL, which a REVOKE that skips it leaves in place.
-- ────────────────────────────────────────────────────────────
REVOKE ALL ON TABLE
  public.visa_country_rules,
  public.visa_document_types,
  public.visa_cases,
  public.visa_case_schools,
  public.visa_case_documents,
  public.visa_approval_requests,
  public.visa_case_questions,
  public.visa_case_events
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.visa_country_rules,
  public.visa_document_types,
  public.visa_case_schools
TO authenticated;

-- Case data is never deleted through the API: a case is closed or
-- withdrawn instead, and its documents, requests and questions are
-- history (360, section 10).
GRANT SELECT, INSERT, UPDATE ON TABLE
  public.visa_cases,
  public.visa_case_documents,
  public.visa_approval_requests,
  public.visa_case_questions
TO authenticated;

-- The event log is append-only for everyone, the API included.
GRANT SELECT ON TABLE public.visa_case_events TO authenticated;

GRANT ALL ON TABLE
  public.visa_country_rules,
  public.visa_document_types,
  public.visa_cases,
  public.visa_case_schools,
  public.visa_case_documents,
  public.visa_approval_requests,
  public.visa_case_questions
TO service_role;
GRANT SELECT, INSERT ON TABLE public.visa_case_events TO service_role;

-- ────────────────────────────────────────────────────────────
-- 5. POLICIES
-- ────────────────────────────────────────────────────────────

-- 5a. Country rules and document types: reference data, no personal
--     data. Any signed-in user may read (the student's checklist needs
--     them); only legal writes.
DROP POLICY IF EXISTS "Visa country rules: signed-in read" ON public.visa_country_rules;
CREATE POLICY "Visa country rules: signed-in read"
  ON public.visa_country_rules FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS "Visa country rules: legal insert" ON public.visa_country_rules;
CREATE POLICY "Visa country rules: legal insert"
  ON public.visa_country_rules FOR INSERT TO authenticated
  WITH CHECK (public.visa_is_legal());
DROP POLICY IF EXISTS "Visa country rules: legal update" ON public.visa_country_rules;
CREATE POLICY "Visa country rules: legal update"
  ON public.visa_country_rules FOR UPDATE TO authenticated
  USING (public.visa_is_legal()) WITH CHECK (public.visa_is_legal());
DROP POLICY IF EXISTS "Visa country rules: legal delete" ON public.visa_country_rules;
CREATE POLICY "Visa country rules: legal delete"
  ON public.visa_country_rules FOR DELETE TO authenticated
  USING (public.visa_is_legal());

DROP POLICY IF EXISTS "Visa document types: signed-in read" ON public.visa_document_types;
CREATE POLICY "Visa document types: signed-in read"
  ON public.visa_document_types FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS "Visa document types: legal insert" ON public.visa_document_types;
CREATE POLICY "Visa document types: legal insert"
  ON public.visa_document_types FOR INSERT TO authenticated
  WITH CHECK (public.visa_is_legal());
DROP POLICY IF EXISTS "Visa document types: legal update" ON public.visa_document_types;
CREATE POLICY "Visa document types: legal update"
  ON public.visa_document_types FOR UPDATE TO authenticated
  USING (public.visa_is_legal()) WITH CHECK (public.visa_is_legal());
DROP POLICY IF EXISTS "Visa document types: legal delete" ON public.visa_document_types;
CREATE POLICY "Visa document types: legal delete"
  ON public.visa_document_types FOR DELETE TO authenticated
  USING (public.visa_is_legal());

-- 5b. Cases: legal, the case's school leaders, and the student read.
--     Only legal writes in step 1. A new case has no schools yet, so only
--     global legal inserts one directly; the app creates cases on
--     acceptance through a server route (ensureVisaCase, step 2).
DROP POLICY IF EXISTS "Visa cases: read" ON public.visa_cases;
CREATE POLICY "Visa cases: read"
  ON public.visa_cases FOR SELECT TO authenticated
  USING (
    public.visa_can_manage(id)
    OR user_id = auth.uid()
    OR public.visa_can_follow_up(id)
  );
DROP POLICY IF EXISTS "Visa cases: legal insert" ON public.visa_cases;
CREATE POLICY "Visa cases: legal insert"
  ON public.visa_cases FOR INSERT TO authenticated
  WITH CHECK (public.visa_is_legal());
DROP POLICY IF EXISTS "Visa cases: legal update" ON public.visa_cases;
CREATE POLICY "Visa cases: legal update"
  ON public.visa_cases FOR UPDATE TO authenticated
  USING (public.visa_can_manage(id)) WITH CHECK (public.visa_can_manage(id));
DROP POLICY IF EXISTS "Visa cases: legal delete" ON public.visa_cases;
-- No delete (see grants above).

-- 5c. Case schools: same readers as the case. Documents: see header.
DROP POLICY IF EXISTS "Visa case schools: read" ON public.visa_case_schools;
CREATE POLICY "Visa case schools: read"
  ON public.visa_case_schools FOR SELECT TO authenticated
  USING (
    public.visa_can_manage(case_id)
    OR public.visa_is_own_case(case_id)
    -- A leader of any school on the case sees all its schools, so a
    -- FFX + Leadership Track student's whole stay is visible to both.
    OR public.visa_can_follow_up(case_id)
  );
DROP POLICY IF EXISTS "Visa case schools: legal insert" ON public.visa_case_schools;
CREATE POLICY "Visa case schools: legal insert"
  ON public.visa_case_schools FOR INSERT TO authenticated
  WITH CHECK (public.visa_can_manage(case_id));
DROP POLICY IF EXISTS "Visa case schools: legal update" ON public.visa_case_schools;
CREATE POLICY "Visa case schools: legal update"
  ON public.visa_case_schools FOR UPDATE TO authenticated
  USING (public.visa_can_manage(case_id)) WITH CHECK (public.visa_can_manage(case_id));
DROP POLICY IF EXISTS "Visa case schools: legal delete" ON public.visa_case_schools;
CREATE POLICY "Visa case schools: legal delete"
  ON public.visa_case_schools FOR DELETE TO authenticated
  USING (public.visa_can_manage(case_id));

DROP POLICY IF EXISTS "Visa case documents: read" ON public.visa_case_documents;
CREATE POLICY "Visa case documents: read"
  ON public.visa_case_documents FOR SELECT TO authenticated
  USING (
    public.visa_is_own_case(case_id)
    OR public.visa_is_legal()
    OR (
      NOT public.visa_type_is_restricted(document_type_id)
      AND (public.visa_can_manage(case_id) OR public.visa_leader_can_see_documents(case_id))
    )
  );
DROP POLICY IF EXISTS "Visa case documents: legal insert" ON public.visa_case_documents;
CREATE POLICY "Visa case documents: legal insert"
  ON public.visa_case_documents FOR INSERT TO authenticated
  WITH CHECK (public.visa_can_manage(case_id));
DROP POLICY IF EXISTS "Visa case documents: legal update" ON public.visa_case_documents;
CREATE POLICY "Visa case documents: legal update"
  ON public.visa_case_documents FOR UPDATE TO authenticated
  USING (public.visa_can_manage(case_id)) WITH CHECK (public.visa_can_manage(case_id));
DROP POLICY IF EXISTS "Visa case documents: legal delete" ON public.visa_case_documents;
-- No delete (see grants above).

-- 5d. Approval requests and questions: internal between leaders and
--     legal. The student does not see them.
DROP POLICY IF EXISTS "Visa approval requests: read" ON public.visa_approval_requests;
CREATE POLICY "Visa approval requests: read"
  ON public.visa_approval_requests FOR SELECT TO authenticated
  USING (public.visa_can_manage(case_id) OR public.visa_can_follow_up(case_id));
DROP POLICY IF EXISTS "Visa approval requests: legal insert" ON public.visa_approval_requests;
CREATE POLICY "Visa approval requests: legal insert"
  ON public.visa_approval_requests FOR INSERT TO authenticated
  WITH CHECK (public.visa_can_manage(case_id));
DROP POLICY IF EXISTS "Visa approval requests: legal update" ON public.visa_approval_requests;
CREATE POLICY "Visa approval requests: legal update"
  ON public.visa_approval_requests FOR UPDATE TO authenticated
  USING (public.visa_can_manage(case_id)) WITH CHECK (public.visa_can_manage(case_id));
DROP POLICY IF EXISTS "Visa approval requests: legal delete" ON public.visa_approval_requests;
-- No delete (see grants above).

DROP POLICY IF EXISTS "Visa questions: read" ON public.visa_case_questions;
CREATE POLICY "Visa questions: read"
  ON public.visa_case_questions FOR SELECT TO authenticated
  USING (public.visa_can_manage(case_id) OR public.visa_can_follow_up(case_id));
DROP POLICY IF EXISTS "Visa questions: legal insert" ON public.visa_case_questions;
CREATE POLICY "Visa questions: legal insert"
  ON public.visa_case_questions FOR INSERT TO authenticated
  WITH CHECK (public.visa_can_manage(case_id));
DROP POLICY IF EXISTS "Visa questions: legal update" ON public.visa_case_questions;
CREATE POLICY "Visa questions: legal update"
  ON public.visa_case_questions FOR UPDATE TO authenticated
  USING (public.visa_can_manage(case_id)) WITH CHECK (public.visa_can_manage(case_id));
DROP POLICY IF EXISTS "Visa questions: legal delete" ON public.visa_case_questions;
-- No delete (see grants above).

-- 5e. Event log: leaders and legal read; nobody writes through the API
--     as a user (service role and step-2 definer functions append).
DROP POLICY IF EXISTS "Visa events: read" ON public.visa_case_events;
CREATE POLICY "Visa events: read"
  ON public.visa_case_events FOR SELECT TO authenticated
  USING (public.visa_can_manage(case_id) OR public.visa_can_follow_up(case_id));

-- ────────────────────────────────────────────────────────────
-- 6. PRIVATE BUCKET — no storage.objects policies (see header)
-- ────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'visa-documents',
  'visa-documents',
  false,
  10485760,  -- 10 MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
-- DO UPDATE, not DO NOTHING: if the bucket already exists (made by hand,
-- say, and public), this makes it private with these limits.
ON CONFLICT (id) DO UPDATE
  SET public             = false,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMIT;
