-- DO NOT APPLY until Jack says so.
-- ============================================================
-- FFSA Hub — Migration 371: Legal → Documents (RLS, grants, bucket)
-- ============================================================
-- Who sees what: only the people on public.legal_access.
--
--   * owner / reviewer rows (folder_id NULL): the whole module.
--   * helper rows (folder_id set): that one folder, read-only unless
--     can_edit. Not used in step 1; the policies already honour them.
--   * A row counts only while ends_on is today or later (Johannesburg
--     date) and the account is active (users.is_active IS NOT FALSE, as
--     in 313).
--
-- HARD WALL. is_admin(), has_permission() and every role are absent from
-- every policy here, on purpose: the legal officer is herself a
-- super_admin, so a role-based rule would let every other super admin
-- read her papers. Same approach as the Missio tables (329).
--
-- The access list itself is written by the service role only in step 1
-- (no INSERT / UPDATE / DELETE policy on legal_access). Members can read
-- it, so the owner can see who else has access.
--
-- The 'legal-documents' bucket is private with NO storage.objects
-- policies (same as visa-documents, 361): the API reads the legal_files
-- row as the user (so RLS decides), then signs a short-lived URL with
-- the service role. Never sign a path the user could not read.
--
-- Additive only. Idempotent: CREATE OR REPLACE, DROP POLICY IF EXISTS,
-- ON CONFLICT DO NOTHING; REVOKE ALL before GRANT so re-running is clean.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. HELPERS (definer: they read legal_access / users without
--    depending on the caller's visibility, which would recurse)
-- ────────────────────────────────────────────────────────────

-- Whole-module access. p_edit = true also requires can_edit.
CREATE OR REPLACE FUNCTION public.legal_has_access(p_edit boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.legal_access a
         JOIN public.users u ON u.id = a.user_id
        WHERE a.user_id = auth.uid()
          AND a.folder_id IS NULL
          AND u.is_active IS NOT FALSE
          AND (a.ends_on IS NULL
               OR a.ends_on >= (now() AT TIME ZONE 'Africa/Johannesburg')::date)
          AND (NOT p_edit OR a.can_edit)
     );
$$;

-- Access to one folder: whole-module access, or a helper row for it.
CREATE OR REPLACE FUNCTION public.legal_folder_access(p_folder_id uuid, p_edit boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.legal_has_access(p_edit)
      OR (auth.uid() IS NOT NULL
          AND p_folder_id IS NOT NULL
          AND EXISTS (
            SELECT 1
              FROM public.legal_access a
              JOIN public.users u ON u.id = a.user_id
             WHERE a.user_id = auth.uid()
               AND a.folder_id = p_folder_id
               AND u.is_active IS NOT FALSE
               AND (a.ends_on IS NULL
                    OR a.ends_on >= (now() AT TIME ZONE 'Africa/Johannesburg')::date)
               AND (NOT p_edit OR a.can_edit)
          ));
$$;

-- Anyone with any live row (whole or one folder): may read the type list.
CREATE OR REPLACE FUNCTION public.legal_any_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.legal_access a
         JOIN public.users u ON u.id = a.user_id
        WHERE a.user_id = auth.uid()
          AND u.is_active IS NOT FALSE
          AND (a.ends_on IS NULL
               OR a.ends_on >= (now() AT TIME ZONE 'Africa/Johannesburg')::date)
     );
$$;

-- Access to an application's folder, for the steps policies. Returns a
-- yes/no, never the folder id, so it reveals nothing to a caller.
CREATE OR REPLACE FUNCTION public.legal_application_access(p_application_id uuid, p_edit boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT public.legal_folder_access(a.folder_id, p_edit)
      FROM public.legal_applications a
     WHERE a.id = p_application_id
  ), false);
$$;

REVOKE ALL ON FUNCTION public.legal_has_access(boolean)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.legal_folder_access(uuid, boolean)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.legal_any_access()                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.legal_application_access(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legal_has_access(boolean)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.legal_folder_access(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.legal_any_access()                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.legal_application_access(uuid, boolean) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 2. ENABLE RLS
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.legal_access             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_folders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_document_types     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_documents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_files              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_applications       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_application_steps  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_events             ENABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────
-- 3. GRANTS — table privileges; RLS below decides which rows.
--    service_role is named in the REVOKE on purpose (see 307).
-- ────────────────────────────────────────────────────────────
REVOKE ALL ON TABLE
  public.legal_access,
  public.legal_folders,
  public.legal_document_types,
  public.legal_documents,
  public.legal_files,
  public.legal_applications,
  public.legal_application_steps,
  public.legal_events
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.legal_folders,
  public.legal_document_types,
  public.legal_documents,
  public.legal_files,
  public.legal_applications,
  public.legal_application_steps
TO authenticated;

-- Access list and event log: read-only for signed-in users.
GRANT SELECT ON TABLE public.legal_access, public.legal_events TO authenticated;

GRANT ALL ON TABLE
  public.legal_access,
  public.legal_folders,
  public.legal_document_types,
  public.legal_documents,
  public.legal_files,
  public.legal_applications,
  public.legal_application_steps
TO service_role;
-- The event log is written only by its trigger, never directly.
GRANT SELECT ON TABLE public.legal_events TO service_role;

-- ────────────────────────────────────────────────────────────
-- 4. POLICIES
-- ────────────────────────────────────────────────────────────

-- 4a. Access list: your own rows, or every row if you have the whole
--     module. No write policies: service role only in step 1.
DROP POLICY IF EXISTS "Legal access: read" ON public.legal_access;
CREATE POLICY "Legal access: read"
  ON public.legal_access FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.legal_has_access());

-- 4b. Folders: read with folder access; only whole-module editors
--     create, change or remove folders.
DROP POLICY IF EXISTS "Legal folders: read" ON public.legal_folders;
CREATE POLICY "Legal folders: read"
  ON public.legal_folders FOR SELECT TO authenticated
  USING (public.legal_folder_access(id));
DROP POLICY IF EXISTS "Legal folders: insert" ON public.legal_folders;
CREATE POLICY "Legal folders: insert"
  ON public.legal_folders FOR INSERT TO authenticated
  WITH CHECK (public.legal_has_access(true));
DROP POLICY IF EXISTS "Legal folders: update" ON public.legal_folders;
CREATE POLICY "Legal folders: update"
  ON public.legal_folders FOR UPDATE TO authenticated
  USING (public.legal_has_access(true)) WITH CHECK (public.legal_has_access(true));
DROP POLICY IF EXISTS "Legal folders: delete" ON public.legal_folders;
CREATE POLICY "Legal folders: delete"
  ON public.legal_folders FOR DELETE TO authenticated
  USING (public.legal_has_access(true));

-- 4c. Document types: reference data, no personal data. Anyone on the
--     list reads; whole-module editors write.
DROP POLICY IF EXISTS "Legal document types: read" ON public.legal_document_types;
CREATE POLICY "Legal document types: read"
  ON public.legal_document_types FOR SELECT TO authenticated
  USING (public.legal_any_access());
DROP POLICY IF EXISTS "Legal document types: insert" ON public.legal_document_types;
CREATE POLICY "Legal document types: insert"
  ON public.legal_document_types FOR INSERT TO authenticated
  WITH CHECK (public.legal_has_access(true));
DROP POLICY IF EXISTS "Legal document types: update" ON public.legal_document_types;
CREATE POLICY "Legal document types: update"
  ON public.legal_document_types FOR UPDATE TO authenticated
  USING (public.legal_has_access(true)) WITH CHECK (public.legal_has_access(true));
DROP POLICY IF EXISTS "Legal document types: delete" ON public.legal_document_types;
CREATE POLICY "Legal document types: delete"
  ON public.legal_document_types FOR DELETE TO authenticated
  USING (public.legal_has_access(true));

-- 4d. Documents, files, applications: by folder. UPDATE checks both the
--     old folder (USING) and the new one (WITH CHECK), so moving a row
--     needs edit rights on both.
DO $$
DECLARE
  t text;
  label text;
BEGIN
  FOREACH t IN ARRAY ARRAY['legal_documents', 'legal_files', 'legal_applications'] LOOP
    label := initcap(replace(replace(t, 'legal_', 'legal '), '_', ' '));

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', label || ': read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
         USING (public.legal_folder_access(folder_id))',
      label || ': read', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', label || ': insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
         WITH CHECK (public.legal_folder_access(folder_id, true))',
      label || ': insert', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', label || ': update', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
         USING (public.legal_folder_access(folder_id, true))
         WITH CHECK (public.legal_folder_access(folder_id, true))',
      label || ': update', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', label || ': delete', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
         USING (public.legal_folder_access(folder_id, true))',
      label || ': delete', t);
  END LOOP;
END $$;

-- 4e. Application steps: through their application's folder.
DROP POLICY IF EXISTS "Legal application steps: read" ON public.legal_application_steps;
CREATE POLICY "Legal application steps: read"
  ON public.legal_application_steps FOR SELECT TO authenticated
  USING (public.legal_application_access(application_id));
DROP POLICY IF EXISTS "Legal application steps: insert" ON public.legal_application_steps;
CREATE POLICY "Legal application steps: insert"
  ON public.legal_application_steps FOR INSERT TO authenticated
  WITH CHECK (public.legal_application_access(application_id, true));
DROP POLICY IF EXISTS "Legal application steps: update" ON public.legal_application_steps;
CREATE POLICY "Legal application steps: update"
  ON public.legal_application_steps FOR UPDATE TO authenticated
  USING (public.legal_application_access(application_id, true))
  WITH CHECK (public.legal_application_access(application_id, true));
DROP POLICY IF EXISTS "Legal application steps: delete" ON public.legal_application_steps;
CREATE POLICY "Legal application steps: delete"
  ON public.legal_application_steps FOR DELETE TO authenticated
  USING (public.legal_application_access(application_id, true));

-- 4f. Event log: whole-module members only (it spans every folder).
DROP POLICY IF EXISTS "Legal events: read" ON public.legal_events;
CREATE POLICY "Legal events: read"
  ON public.legal_events FOR SELECT TO authenticated
  USING (public.legal_has_access());

-- ────────────────────────────────────────────────────────────
-- 5. PRIVATE BUCKET (no storage.objects policies — see header)
-- ────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'legal-documents',
  'legal-documents',
  false,
  52428800,  -- 50 MB: multi-page scans
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Validation (run after applying; the SET ROLE checks need a test
-- user id in request.jwt.claims — see the Supabase docs on RLS testing)
-- ------------------------------------------------------------
--   SELECT tablename, rowsecurity FROM pg_tables
--    WHERE schemaname = 'public' AND tablename LIKE 'legal\_%';      -- all true
--   SELECT tablename, policyname, qual, with_check FROM pg_policies
--    WHERE tablename LIKE 'legal\_%'
--      AND (coalesce(qual, '') || coalesce(with_check, '')) ~ 'is_admin|has_permission';
--                                                                    -- no rows
--   SELECT id, public FROM storage.buckets WHERE id = 'legal-documents'; -- false
--   SELECT policyname FROM pg_policies
--    WHERE schemaname = 'storage'
--      AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%legal-documents%';
--                                                                    -- no rows
-- ============================================================
