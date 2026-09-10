-- ============================================================
-- FFSA Hub — Migration 061: Records Library RLS
-- ============================================================
-- Access model:
--   * super_admin / admin                       → full access
--   * users with manage_records_library perm    → full access
--   * regular users                             → read only the records
--                                                 linked to their own user_id
--
-- SUPERSEDED IN PART BY MIGRATION 212: the `admin` role no longer gets
-- Records Library access. The policies/guards below now read
-- public.can_access_records_library() (super_admin OR records_library.manage)
-- instead of public.is_admin() OR has_permission(...).
-- ============================================================

ALTER TABLE public.library_imports        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_templates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_persons        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_applications   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_payments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_enrollments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_documents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_match_queue    ENABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────
-- library_imports
-- ────────────────────────────────────────────────────────────

CREATE POLICY "Records library admins can manage imports"
  ON public.library_imports FOR ALL
  USING (public.is_admin() OR public.has_permission('records_library.manage'))
  WITH CHECK (public.is_admin() OR public.has_permission('records_library.manage'));

-- ────────────────────────────────────────────────────────────
-- library_templates
-- ────────────────────────────────────────────────────────────

CREATE POLICY "Records library admins can manage templates"
  ON public.library_templates FOR ALL
  USING (public.is_admin() OR public.has_permission('records_library.manage'))
  WITH CHECK (public.is_admin() OR public.has_permission('records_library.manage'));

-- ────────────────────────────────────────────────────────────
-- library_persons
-- ────────────────────────────────────────────────────────────

CREATE POLICY "Users can read own library person"
  ON public.library_persons FOR SELECT
  USING (linked_user_id = auth.uid());

CREATE POLICY "Records library admins can manage persons"
  ON public.library_persons FOR ALL
  USING (public.is_admin() OR public.has_permission('records_library.manage'))
  WITH CHECK (public.is_admin() OR public.has_permission('records_library.manage'));

-- ────────────────────────────────────────────────────────────
-- library_applications
-- ────────────────────────────────────────────────────────────

CREATE POLICY "Users can read own library applications"
  ON public.library_applications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Records library admins can manage applications"
  ON public.library_applications FOR ALL
  USING (public.is_admin() OR public.has_permission('records_library.manage'))
  WITH CHECK (public.is_admin() OR public.has_permission('records_library.manage'));

-- ────────────────────────────────────────────────────────────
-- library_payments
-- ────────────────────────────────────────────────────────────

CREATE POLICY "Users can read own library payments"
  ON public.library_payments FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Records library admins can manage payments"
  ON public.library_payments FOR ALL
  USING (public.is_admin() OR public.has_permission('records_library.manage'))
  WITH CHECK (public.is_admin() OR public.has_permission('records_library.manage'));

-- ────────────────────────────────────────────────────────────
-- library_enrollments
-- ────────────────────────────────────────────────────────────

CREATE POLICY "Users can read own library enrollments"
  ON public.library_enrollments FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Records library admins can manage enrollments"
  ON public.library_enrollments FOR ALL
  USING (public.is_admin() OR public.has_permission('records_library.manage'))
  WITH CHECK (public.is_admin() OR public.has_permission('records_library.manage'));

-- ────────────────────────────────────────────────────────────
-- library_documents
-- ────────────────────────────────────────────────────────────

CREATE POLICY "Users can read own library documents"
  ON public.library_documents FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Records library admins can manage documents"
  ON public.library_documents FOR ALL
  USING (public.is_admin() OR public.has_permission('records_library.manage'))
  WITH CHECK (public.is_admin() OR public.has_permission('records_library.manage'));

-- ────────────────────────────────────────────────────────────
-- library_match_queue
-- ────────────────────────────────────────────────────────────

CREATE POLICY "Records library admins can manage match queue"
  ON public.library_match_queue FOR ALL
  USING (public.is_admin() OR public.has_permission('records_library.manage'))
  WITH CHECK (public.is_admin() OR public.has_permission('records_library.manage'));
