-- ============================================================
-- FFSA Hub — Migration 212: Records Library is super_admin only
-- ============================================================
-- The `admin` role ("general admin") is otherwise identical to
-- super_admin: both pass the public.is_admin() bypass that every
-- other module's RLS relies on. This migration carves the Records
-- Library out of that bypass, because it holds the historical CSV
-- imports of staff/student personal data.
--
-- New access rule for every library_* table and RPC:
--     super_admin
--  OR holder of `records_library.manage` (direct grant or via an
--     assigned role's bundle — has_permission() covers both)
--
-- A plain `admin` no longer qualifies. A super admin can hand any
-- admin the `records_library.manage` permission to grant access back.
--
-- Self-read policies ("Users can read own …") are untouched: a user
-- can always see their own linked rows.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. The rule, in one place
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.can_access_records_library()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_any_role(ARRAY['super_admin'])
      OR public.has_permission('records_library.manage');
$$;

COMMENT ON FUNCTION public.can_access_records_library() IS
  'Records Library access: super_admin, or an explicit records_library.manage grant. Deliberately does NOT use is_admin() — the general `admin` role is excluded.';

-- ────────────────────────────────────────────────────────────
-- 2. RLS policies (replacing the is_admin() variants from 061)
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Records library admins can manage imports"     ON public.library_imports;
DROP POLICY IF EXISTS "Records library admins can manage templates"   ON public.library_templates;
DROP POLICY IF EXISTS "Records library admins can manage persons"     ON public.library_persons;
DROP POLICY IF EXISTS "Records library admins can manage applications" ON public.library_applications;
DROP POLICY IF EXISTS "Records library admins can manage payments"    ON public.library_payments;
DROP POLICY IF EXISTS "Records library admins can manage enrollments" ON public.library_enrollments;
DROP POLICY IF EXISTS "Records library admins can manage documents"   ON public.library_documents;
DROP POLICY IF EXISTS "Records library admins can manage match queue" ON public.library_match_queue;

CREATE POLICY "Records library admins can manage imports"
  ON public.library_imports FOR ALL
  USING (public.can_access_records_library())
  WITH CHECK (public.can_access_records_library());

CREATE POLICY "Records library admins can manage templates"
  ON public.library_templates FOR ALL
  USING (public.can_access_records_library())
  WITH CHECK (public.can_access_records_library());

CREATE POLICY "Records library admins can manage persons"
  ON public.library_persons FOR ALL
  USING (public.can_access_records_library())
  WITH CHECK (public.can_access_records_library());

CREATE POLICY "Records library admins can manage applications"
  ON public.library_applications FOR ALL
  USING (public.can_access_records_library())
  WITH CHECK (public.can_access_records_library());

CREATE POLICY "Records library admins can manage payments"
  ON public.library_payments FOR ALL
  USING (public.can_access_records_library())
  WITH CHECK (public.can_access_records_library());

CREATE POLICY "Records library admins can manage enrollments"
  ON public.library_enrollments FOR ALL
  USING (public.can_access_records_library())
  WITH CHECK (public.can_access_records_library());

CREATE POLICY "Records library admins can manage documents"
  ON public.library_documents FOR ALL
  USING (public.can_access_records_library())
  WITH CHECK (public.can_access_records_library());

CREATE POLICY "Records library admins can manage match queue"
  ON public.library_match_queue FOR ALL
  USING (public.can_access_records_library())
  WITH CHECK (public.can_access_records_library());

-- ────────────────────────────────────────────────────────────
-- 3. RPC guards (bodies unchanged from 063 — only the guard swaps)
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.approve_library_match(
  p_queue_id uuid,
  p_notes    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_person_id uuid;
  v_user_id   uuid;
BEGIN
  IF NOT public.can_access_records_library() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT person_id, user_id
    INTO v_person_id, v_user_id
  FROM public.library_match_queue
  WHERE id = p_queue_id AND status = 'pending';

  IF v_person_id IS NULL THEN
    RAISE EXCEPTION 'Queue item not found or already resolved';
  END IF;

  PERFORM public._library_cascade_link(
    v_person_id,
    v_user_id,
    'queue_approval',
    auth.uid()
  );

  UPDATE public.library_match_queue
  SET status           = 'approved',
      resolved_by      = auth.uid(),
      resolved_at      = now(),
      resolution_notes = p_notes
  WHERE id = p_queue_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_library_match(
  p_queue_id uuid,
  p_notes    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_access_records_library() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.library_match_queue
  SET status           = 'rejected',
      resolved_by      = auth.uid(),
      resolved_at      = now(),
      resolution_notes = p_notes
  WHERE id = p_queue_id AND status = 'pending';
END;
$$;

CREATE OR REPLACE FUNCTION public.manual_link_library_person(
  p_person_id uuid,
  p_user_id   uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_access_records_library() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  PERFORM public._library_cascade_link(
    p_person_id,
    p_user_id,
    'manual',
    auth.uid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.unlink_library_person(p_person_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_access_records_library() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.library_persons
  SET linked_user_id = NULL,
      linked_at      = NULL,
      linked_by      = NULL,
      link_method    = NULL
  WHERE id = p_person_id;

  UPDATE public.library_applications SET user_id = NULL WHERE person_id = p_person_id;
  UPDATE public.library_payments     SET user_id = NULL WHERE person_id = p_person_id;
  UPDATE public.library_enrollments  SET user_id = NULL WHERE person_id = p_person_id;
  UPDATE public.library_documents    SET user_id = NULL WHERE person_id = p_person_id;
END;
$$;
