-- DO NOT APPLY until Jack says so. Needs 370–373 first.
-- ============================================================
-- FFSA Hub — Migration 374: Legal → Documents (drafts and approval)
-- ============================================================
-- The legal helper (a Claude chat inside Documents) drafts letters and
-- fills in forms. It can only SAVE A DRAFT. A draft becomes final only
-- when the OWNER on legal_access (the legal officer) approves it; the
-- approved version is rendered to PDF, stored in the draft's folder as a
-- legal_files row, and can never change again.
--
-- The approval rule lives here, in a trigger, not in the app:
--   * nothing is inserted already approved;
--   * moving a draft to 'approved' requires public.legal_is_owner() — the
--     signed-in owner. The service role has no auth.uid(), so not even the
--     server can approve on her behalf; reviewers and helpers can't either;
--   * an approval must name its final file, and stamps who and when;
--   * an approved draft can no longer be changed or deleted.
--
-- Access otherwise follows the folder, like documents (371).
-- Additive only. Idempotent.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. OWNER CHECK (definer: reads legal_access regardless of caller)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.legal_is_owner()
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
          AND a.access_role = 'owner'
          AND a.folder_id IS NULL
          AND u.is_active IS NOT FALSE
          AND (a.ends_on IS NULL
               OR a.ends_on >= (now() AT TIME ZONE 'Africa/Johannesburg')::date)
     );
$$;

REVOKE ALL ON FUNCTION public.legal_is_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legal_is_owner() TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 2. DRAFTS
-- ────────────────────────────────────────────────────────────
-- fields: for forms, one entry per field, e.g.
--   [{"label": "Registration number", "value": "…", "source": "NPO certificate", "missing": false}]
-- notes_for_approver: what the helper wants checked before approval.
CREATE TABLE IF NOT EXISTS public.legal_drafts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id           uuid NOT NULL REFERENCES public.legal_folders(id) ON DELETE RESTRICT,
  document_id         uuid REFERENCES public.legal_documents(id) ON DELETE SET NULL,
  application_id      uuid REFERENCES public.legal_applications(id) ON DELETE SET NULL,
  title               text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  kind                text NOT NULL DEFAULT 'letter' CHECK (kind IN ('letter', 'form', 'other')),
  body                text NOT NULL DEFAULT '' CHECK (length(body) <= 60000),
  fields              jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(fields) = 'array'),
  notes_for_approver  text CHECK (notes_for_approver IS NULL OR length(notes_for_approver) <= 4000),
  status              text NOT NULL DEFAULT 'awaiting_approval'
                      CHECK (status IN ('awaiting_approval', 'sent_back', 'approved')),
  sent_back_note      text CHECK (sent_back_note IS NULL OR length(sent_back_note) <= 2000),
  created_via         text NOT NULL DEFAULT 'helper' CHECK (created_via IN ('helper', 'person')),
  final_file_id       uuid REFERENCES public.legal_files(id) ON DELETE SET NULL,
  approved_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at         timestamptz,
  created_by          uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_drafts_approved_shape CHECK (
    (status = 'approved') = (approved_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS legal_drafts_folder_idx   ON public.legal_drafts (folder_id);
CREATE INDEX IF NOT EXISTS legal_drafts_status_idx   ON public.legal_drafts (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS legal_drafts_document_idx ON public.legal_drafts (document_id);

-- ────────────────────────────────────────────────────────────
-- 3. THE APPROVAL RULE
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.legal_drafts_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'approved' OR NEW.approved_at IS NOT NULL OR NEW.approved_by IS NOT NULL THEN
      RAISE EXCEPTION 'A draft cannot start out approved' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'approved' THEN
      RAISE EXCEPTION 'An approved draft is part of the record and cannot be deleted' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF OLD.status = 'approved' THEN
    RAISE EXCEPTION 'An approved draft can no longer change' USING ERRCODE = '42501';
  END IF;

  IF NEW.status = 'approved' THEN
    IF NOT public.legal_is_owner() THEN
      RAISE EXCEPTION 'Only the legal officer can approve a draft' USING ERRCODE = '42501';
    END IF;
    IF NEW.final_file_id IS NULL THEN
      RAISE EXCEPTION 'An approval needs its final file' USING ERRCODE = '23514';
    END IF;
    NEW.approved_by := auth.uid();
    NEW.approved_at := now();
  ELSE
    -- Only an approval may set these.
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
    NEW.final_file_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.legal_drafts_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS legal_drafts_guard_ins ON public.legal_drafts;
CREATE TRIGGER legal_drafts_guard_ins BEFORE INSERT ON public.legal_drafts
  FOR EACH ROW EXECUTE FUNCTION public.legal_drafts_guard();
DROP TRIGGER IF EXISTS legal_drafts_guard_upd ON public.legal_drafts;
CREATE TRIGGER legal_drafts_guard_upd BEFORE UPDATE ON public.legal_drafts
  FOR EACH ROW EXECUTE FUNCTION public.legal_drafts_guard();
DROP TRIGGER IF EXISTS legal_drafts_guard_del ON public.legal_drafts;
CREATE TRIGGER legal_drafts_guard_del BEFORE DELETE ON public.legal_drafts
  FOR EACH ROW EXECUTE FUNCTION public.legal_drafts_guard();

DROP TRIGGER IF EXISTS legal_drafts_updated_at ON public.legal_drafts;
CREATE TRIGGER legal_drafts_updated_at BEFORE UPDATE ON public.legal_drafts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS legal_drafts_log ON public.legal_drafts;
CREATE TRIGGER legal_drafts_log AFTER INSERT OR UPDATE OR DELETE ON public.legal_drafts
  FOR EACH ROW EXECUTE FUNCTION public.legal_log_event();

-- ────────────────────────────────────────────────────────────
-- 4. RLS AND GRANTS — by folder, like documents (371)
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.legal_drafts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.legal_drafts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.legal_drafts TO authenticated;
GRANT ALL ON TABLE public.legal_drafts TO service_role;

DROP POLICY IF EXISTS "Legal drafts: read" ON public.legal_drafts;
CREATE POLICY "Legal drafts: read"
  ON public.legal_drafts FOR SELECT TO authenticated
  USING (public.legal_folder_access(folder_id));
DROP POLICY IF EXISTS "Legal drafts: insert" ON public.legal_drafts;
CREATE POLICY "Legal drafts: insert"
  ON public.legal_drafts FOR INSERT TO authenticated
  WITH CHECK (public.legal_folder_access(folder_id, true));
DROP POLICY IF EXISTS "Legal drafts: update" ON public.legal_drafts;
CREATE POLICY "Legal drafts: update"
  ON public.legal_drafts FOR UPDATE TO authenticated
  USING (public.legal_folder_access(folder_id, true))
  WITH CHECK (public.legal_folder_access(folder_id, true));
DROP POLICY IF EXISTS "Legal drafts: delete" ON public.legal_drafts;
CREATE POLICY "Legal drafts: delete"
  ON public.legal_drafts FOR DELETE TO authenticated
  USING (public.legal_folder_access(folder_id, true));

-- ============================================================
-- Validation (run after applying)
-- ------------------------------------------------------------
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'legal_drafts';   -- true
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.legal_drafts'::regclass
--    AND NOT tgisinternal ORDER BY 1;  -- guard_del, guard_ins, guard_upd, log, updated_at
-- ============================================================
