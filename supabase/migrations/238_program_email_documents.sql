-- ============================================================
-- FFSA Hub — Migration 238: documents attached to school emails
-- ============================================================
-- A school's leaders can upload documents (packing list, visa letter,
-- handbook, fee schedule…) against any email in the school's onboarding
-- process — application received, reference request/reminder, declined,
-- waitlisted, interview scheduled, accepted, and the HUB setup link. Every
-- time that email goes out for that school, its documents go with it as
-- real file attachments.
--
-- One row per document. email_type is validated in app code against the
-- catalog in src/lib/email/program-email-documents.ts (the six editable
-- template types plus 'application_accepted' and 'account_setup_link'),
-- not by a DB CHECK, matching program_email_templates (migration 146).
--
-- Files live in the private 'program-email-documents' bucket. All reads and
-- writes go through service-role API routes gated on userCanManageProgram,
-- so no storage.objects policies are needed (same as waiver-documents, 163).
--
-- email_messages.attachments records the filenames that actually went out
-- with each send, so the delivery history shows what a student was sent.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.program_email_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id    uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  email_type    text NOT NULL,
  storage_path  text NOT NULL,
  file_name     text NOT NULL,      -- the name the recipient sees
  content_type  text NOT NULL,
  size_bytes    integer NOT NULL CHECK (size_bytes > 0),
  sort_order    integer NOT NULL DEFAULT 0,
  uploaded_by   uuid REFERENCES public.users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS program_email_documents_lookup_idx
  ON public.program_email_documents (program_id, email_type, sort_order);

ALTER TABLE public.program_email_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read program email documents" ON public.program_email_documents;
CREATE POLICY "Read program email documents"
  ON public.program_email_documents FOR SELECT
  USING (public.has_schools_access(program_id));

DROP POLICY IF EXISTS "Manage program email documents" ON public.program_email_documents;
CREATE POLICY "Manage program email documents"
  ON public.program_email_documents FOR ALL
  USING (public.has_schools_access(program_id))
  WITH CHECK (public.has_schools_access(program_id));

COMMENT ON TABLE public.program_email_documents IS
  'Files a school attaches to one of its onboarding emails (email_type). Sent as real attachments every time that email goes out for that school.';

-- What was attached to each sent email: [{ "name": "...", "size": 123 }].
ALTER TABLE public.email_messages
  ADD COLUMN IF NOT EXISTS attachments jsonb;

-- Private bucket. 10 MB per file; the app also caps each email's total.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'program-email-documents',
  'program-email-documents',
  false,
  10485760,  -- 10 MB
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
    'image/jpeg'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   SELECT policyname FROM pg_policies WHERE tablename = 'program_email_documents';
--   SELECT id, public FROM storage.buckets WHERE id = 'program-email-documents';
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'email_messages' AND column_name = 'attachments';
-- ============================================================
