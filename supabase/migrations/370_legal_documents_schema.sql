-- DO NOT APPLY until Jack says so.
-- ============================================================
-- FFSA Hub — Migration 370: Legal → Documents (schema)
-- ============================================================
-- One place for FFSA's legal and compliance papers and the legal
-- officer's own papers: what is held, when it runs out, what is being
-- applied for, and the scans behind it. Plan: docs/legal-documents.md.
--
-- Build step 1 of 4: the tables only. RLS, grants and the private
-- 'legal-documents' bucket are in 371; the draft type list, the access
-- list and starter folders are in 372.
--
-- Additive only: new tables, indexes and triggers. No existing table or
-- function changes. Idempotent (IF NOT EXISTS / DROP TRIGGER IF EXISTS).
--
-- Files live at '<folder id>/<file id>.<ext>' (CHECK below), so no
-- storage path carries a person's name.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. ACCESS LIST — the only way in (see 371)
-- ────────────────────────────────────────────────────────────
-- owner    = the legal officer.
-- reviewer = temporary access while the module is built and tested.
-- ends_on  = last day the row counts (NULL = open-ended).
-- Room for later: helpers scoped to one folder (folder_id) with
-- can_edit false. Step 1 only uses whole-module rows.
CREATE TABLE IF NOT EXISTS public.legal_access (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  access_role text NOT NULL CHECK (access_role IN ('owner', 'reviewer', 'helper')),
  folder_id   uuid,  -- FK added after legal_folders exists (section 2)
  can_edit    boolean NOT NULL DEFAULT true,
  ends_on     date,
  note        text,
  granted_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- owners and reviewers cover the whole module; helpers are per folder
  CONSTRAINT legal_access_scope CHECK (
    (access_role IN ('owner', 'reviewer') AND folder_id IS NULL)
    OR (access_role = 'helper' AND folder_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS legal_access_user_whole_uidx
  ON public.legal_access (user_id) WHERE folder_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS legal_access_user_folder_uidx
  ON public.legal_access (user_id, folder_id) WHERE folder_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 2. FOLDERS
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.legal_folders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  kind         text NOT NULL CHECK (kind IN ('organisation', 'personal', 'project')),
  description  text,
  sort_order   integer NOT NULL DEFAULT 0,
  archived_at  timestamptz,
  created_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'legal_access_folder_fk'
  ) THEN
    ALTER TABLE public.legal_access
      ADD CONSTRAINT legal_access_folder_fk
      FOREIGN KEY (folder_id) REFERENCES public.legal_folders(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 3. DOCUMENT TYPES — catalogue; the seed (372) is a draft
-- ────────────────────────────────────────────────────────────
-- valid_months: usual life of the document (NULL = no fixed expiry).
-- lead_days:    how long before expiry renewal should start.
-- is_confirmed: false until the legal officer has checked the row.
CREATE TABLE IF NOT EXISTS public.legal_document_types (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key           text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9_]{2,60}$'),
  name          text NOT NULL,
  category      text NOT NULL CHECK (category IN ('organisation', 'personal')),
  issuer        text,
  valid_months  integer CHECK (valid_months IS NULL OR valid_months BETWEEN 1 AND 240),
  lead_days     integer NOT NULL DEFAULT 60 CHECK (lead_days BETWEEN 0 AND 730),
  guidance      text,
  is_confirmed  boolean NOT NULL DEFAULT false,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 4. DOCUMENTS — one row per thing held or needed
-- ────────────────────────────────────────────────────────────
-- renew_lead_days NULL = use the type's lead_days.
-- superseded_by: the newer document that replaced this one.
CREATE TABLE IF NOT EXISTS public.legal_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id        uuid NOT NULL REFERENCES public.legal_folders(id) ON DELETE RESTRICT,
  type_id          uuid REFERENCES public.legal_document_types(id) ON DELETE SET NULL,
  title            text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  holder           text,
  issuer           text,
  reference_no     text,
  issued_on        date,
  expires_on       date,
  renew_lead_days  integer CHECK (renew_lead_days IS NULL OR renew_lead_days BETWEEN 0 AND 730),
  status           text NOT NULL DEFAULT 'held'
                   CHECK (status IN ('held', 'applying', 'not_held', 'superseded', 'cancelled')),
  superseded_by    uuid REFERENCES public.legal_documents(id) ON DELETE SET NULL,
  notes            text,
  created_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_documents_dates CHECK (
    issued_on IS NULL OR expires_on IS NULL OR expires_on >= issued_on
  ),
  CONSTRAINT legal_documents_not_self_superseded CHECK (superseded_by IS DISTINCT FROM id)
);

CREATE INDEX IF NOT EXISTS legal_documents_folder_idx  ON public.legal_documents (folder_id);
CREATE INDEX IF NOT EXISTS legal_documents_expires_idx ON public.legal_documents (expires_on)
  WHERE expires_on IS NOT NULL AND status IN ('held', 'applying');
CREATE INDEX IF NOT EXISTS legal_documents_type_idx    ON public.legal_documents (type_id);

-- ────────────────────────────────────────────────────────────
-- 5. FILES — scans and PDFs, with what was read from them
-- ────────────────────────────────────────────────────────────
-- document_id NULL = scanned in but not matched to a document yet.
-- extracted_fields: what was read from the scan, as suggestions, e.g.
--   {"reference_no": {"value": "…", "confirmed": false}, "expires_on": {…}}
-- Nothing here is copied onto the document until a person confirms it.
CREATE TABLE IF NOT EXISTS public.legal_files (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id          uuid NOT NULL REFERENCES public.legal_folders(id) ON DELETE RESTRICT,
  document_id        uuid REFERENCES public.legal_documents(id) ON DELETE SET NULL,
  storage_path       text NOT NULL UNIQUE,
  original_name      text,
  mime_type          text NOT NULL CHECK (mime_type IN (
                       'application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp')),
  size_bytes         bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 52428800),
  page_count         integer CHECK (page_count IS NULL OR page_count > 0),
  scanned_on         date,
  extraction_status  text NOT NULL DEFAULT 'none'
                     CHECK (extraction_status IN ('none', 'pending', 'done', 'failed')),
  extracted_text     text,
  extracted_fields   jsonb NOT NULL DEFAULT '{}'::jsonb
                     CHECK (jsonb_typeof(extracted_fields) = 'object'),
  extracted_at       timestamptz,
  uploaded_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- '<folder id>/<file id>.<ext>' — never a person's name in a path
  -- (uuids are hex and dashes only, so they are safe inside the pattern)
  CONSTRAINT legal_files_path CHECK (
    storage_path ~ ('^' || folder_id::text || '/' || id::text || '\.[a-z0-9]{2,5}$')
  )
);

CREATE INDEX IF NOT EXISTS legal_files_folder_idx   ON public.legal_files (folder_id);
CREATE INDEX IF NOT EXISTS legal_files_document_idx ON public.legal_files (document_id);
CREATE INDEX IF NOT EXISTS legal_files_unmatched_idx ON public.legal_files (folder_id)
  WHERE document_id IS NULL;

-- ────────────────────────────────────────────────────────────
-- 6. APPLICATIONS — anything being applied for or renewed
-- ────────────────────────────────────────────────────────────
-- document_id: the document this renews or will become (optional).
-- lodge_by: the last day to submit.
CREATE TABLE IF NOT EXISTS public.legal_applications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id       uuid NOT NULL REFERENCES public.legal_folders(id) ON DELETE RESTRICT,
  document_id     uuid REFERENCES public.legal_documents(id) ON DELETE SET NULL,
  title           text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  status          text NOT NULL DEFAULT 'planned'
                  CHECK (status IN ('planned', 'gathering', 'submitted', 'waiting',
                                    'approved', 'refused', 'withdrawn')),
  lodge_by        date,
  submitted_on    date,
  expected_on     date,
  closed_on       date,
  reference_no    text,
  responsible_id  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  notes           text,
  created_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- closed states carry a closing date; open states don't
  CONSTRAINT legal_applications_closed CHECK (
    (status IN ('approved', 'refused', 'withdrawn')) = (closed_on IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS legal_applications_folder_idx   ON public.legal_applications (folder_id);
CREATE INDEX IF NOT EXISTS legal_applications_document_idx ON public.legal_applications (document_id);
CREATE INDEX IF NOT EXISTS legal_applications_open_idx     ON public.legal_applications (lodge_by)
  WHERE status NOT IN ('approved', 'refused', 'withdrawn');

CREATE TABLE IF NOT EXISTS public.legal_application_steps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES public.legal_applications(id) ON DELETE CASCADE,
  position        integer NOT NULL DEFAULT 0,
  label           text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 200),
  due_on          date,
  done_at         timestamptz,
  done_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legal_application_steps_app_idx
  ON public.legal_application_steps (application_id, position);

-- ────────────────────────────────────────────────────────────
-- 7. EVENT LOG — append-only, written by trigger
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.legal_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name  text NOT NULL,
  row_id      uuid NOT NULL,
  action      text NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  changed     text[] NOT NULL DEFAULT '{}',   -- column names, never values
  actor_id    uuid,                            -- auth.uid(); NULL = service role
  at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legal_events_row_idx ON public.legal_events (table_name, row_id, at DESC);

-- Records which columns changed, not their values: the log must not
-- become a second copy of reference numbers or extracted text.
CREATE OR REPLACE FUNCTION public.legal_log_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_changed text[] := '{}';
  v_old jsonb;
  v_new jsonb;
  v_key text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
      IF v_key NOT IN ('updated_at', 'updated_by')
         AND v_new -> v_key IS DISTINCT FROM v_old -> v_key THEN
        v_changed := v_changed || v_key;
      END IF;
    END LOOP;
    IF cardinality(v_changed) = 0 THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.legal_events (table_name, row_id, action, changed, actor_id)
  VALUES (
    TG_TABLE_NAME,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
    lower(TG_OP),
    v_changed,
    auth.uid()
  );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.legal_log_event() FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────
-- 8. TRIGGERS — updated_at and the event log
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'legal_folders', 'legal_document_types', 'legal_documents',
    'legal_files', 'legal_applications', 'legal_application_steps'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_updated_at', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at()',
      t || '_updated_at', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'legal_access', 'legal_folders', 'legal_documents', 'legal_files',
    'legal_applications', 'legal_application_steps'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_log', t);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.legal_log_event()',
      t || '_log', t);
  END LOOP;
END $$;

-- ============================================================
-- Validation (run after applying)
-- ------------------------------------------------------------
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name LIKE 'legal\_%' ORDER BY 1;
--   -- legal_access, legal_application_steps, legal_applications,
--   -- legal_document_types, legal_documents, legal_events,
--   -- legal_files, legal_folders
-- ============================================================
