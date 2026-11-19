-- DO NOT APPLY until Jack says so.
-- ============================================================
-- FFSA Hub — Migration 360: visa applications (schema)
-- ============================================================
-- Visa cases for international students coming to FFSA schools. One case
-- per student per stay: it covers every school (or FFX segment) the
-- student is accepted to back to back, from the first arrival day to the
-- last departure day. School leaders follow cases up; legal (the visa officer)
-- approves the package and signs FFSA's letters.
--
-- Plan and guide: see the visa plan in the side-session notes and the
-- "FFSA Visa Process Guide" doc. This is build step 1 of 4: the tables
-- only. RLS, the private storage bucket and the permission keys are in
-- 361; draft document types are seeded in 362. Letter templates, issued
-- letters and FFSA's standing attachments come in a later step.
--
-- One transaction: it applies whole or not at all.
-- Additive only: new tables, indexes and triggers. No existing table or
-- function changes. Idempotent (IF NOT EXISTS / DROP TRIGGER IF EXISTS).
--
-- Personal data: passport numbers are NEVER stored here. They stay on
-- public.users (and household_members), whose RLS stays "own row +
-- admins" (002). The visa API reads them for staff only after a scoped
-- visas.* check, never through a broad users select. Document files live in the
-- private 'visa-documents' bucket under '<case id>/<document id>.<ext>',
-- enforced by a CHECK below, so no file name carries a person's name.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. COUNTRY RULES — kept by legal (visas.manage)
-- ────────────────────────────────────────────────────────────
-- exempt_days: how long a passport of this country may stay without a
-- visa (0 = no exemption). processing_weeks: the embassy's usual time,
-- used to work out each case's "lodge by" date. NULL = not known yet.
CREATE TABLE IF NOT EXISTS public.visa_country_rules (
  country_iso       text PRIMARY KEY CHECK (country_iso ~ '^[A-Z]{2}$'),
  country_name      text NOT NULL,
  exempt_days       integer NOT NULL DEFAULT 0 CHECK (exempt_days BETWEEN 0 AND 90),
  processing_weeks  integer CHECK (processing_weeks IS NULL OR processing_weeks BETWEEN 1 AND 52),
  needs_extra_care  boolean NOT NULL DEFAULT false,
  guidance          text,
  updated_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 2. DOCUMENT TYPES — the checklist catalogue, kept by legal
-- ────────────────────────────────────────────────────────────
-- A stay of up to 90 days needs fewer documents than a longer one, so
-- each type says which of the two it belongs to. is_offline = a step the
-- student ticks off rather than uploads (signed form, embassy fee).
CREATE TABLE IF NOT EXISTS public.visa_document_types (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_]+$'),
  label            text NOT NULL,
  guidance         text,
  needed_up_to_90  boolean NOT NULL DEFAULT true,
  needed_over_90   boolean NOT NULL DEFAULT true,
  is_conditional   boolean NOT NULL DEFAULT false,  -- only in some cases (e.g. yellow fever)
  is_offline       boolean NOT NULL DEFAULT false,
  needs_certified  boolean NOT NULL DEFAULT false,
  lead_time_weeks  integer CHECK (lead_time_weeks IS NULL OR lead_time_weeks BETWEEN 0 AND 52),
  max_age_months   integer CHECK (max_age_months IS NULL OR max_age_months BETWEEN 1 AND 36),
  sort_order       integer NOT NULL DEFAULT 0,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 3. VISA CASES — one per student per stay
-- ────────────────────────────────────────────────────────────
-- status: the case's place in the flow (mirrors VISA_STATUSES in
-- src/lib/visas/status.ts). waiting_on: who has to act next.
-- stay_from / stay_to: worked out from the schools in visa_case_schools;
-- stay_override_reason is set only when legal overrides them.
CREATE TABLE IF NOT EXISTS public.visa_cases (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT: a case and its history outlive nothing silently (see 10).
  user_id               uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  visa_type             text NOT NULL DEFAULT 'undecided'
                        CHECK (visa_type IN ('undecided', 'exempt', 'visitor', 'volunteer')),
  status                text NOT NULL DEFAULT 'collecting_documents'
                        CHECK (status IN (
                          'collecting_documents',
                          'awaiting_legal',
                          'sent_back',
                          'approved',
                          'lodged',
                          'granted',
                          'refused',
                          'exempt',
                          'arrived',
                          'closed',
                          'withdrawn'
                        )),
  waiting_on            text NOT NULL DEFAULT 'student'
                        CHECK (waiting_on IN ('student', 'school_leader', 'legal', 'embassy', 'nobody')),
  stay_from             date,
  stay_to               date,
  stay_override_reason  text,
  lodge_by              date,
  start_documents_by    date,
  is_standard           boolean NOT NULL DEFAULT false,
  lodged_on             date,
  lodged_where          text,
  embassy_reference     text,
  decided_on            date,
  visa_valid_to         date,
  refusal_reason        text,
  arrived_on            date,
  entry_stamp_ok        boolean,  -- NULL = not checked yet
  closed_at             timestamptz,
  created_by            uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visa_cases_stay_order CHECK (stay_from IS NULL OR stay_to IS NULL OR stay_to >= stay_from)
);

-- A student has at most one open case. A later stay (another year) gets a
-- new case once the first is closed or withdrawn.
CREATE UNIQUE INDEX IF NOT EXISTS visa_cases_one_open_per_user
  ON public.visa_cases (user_id)
  WHERE status NOT IN ('closed', 'withdrawn');

CREATE INDEX IF NOT EXISTS idx_visa_cases_status ON public.visa_cases (status);
CREATE INDEX IF NOT EXISTS idx_visa_cases_lodge_by ON public.visa_cases (lodge_by);

-- ────────────────────────────────────────────────────────────
-- 4. CASE SCHOOLS — the schools / segments a case covers
-- ────────────────────────────────────────────────────────────
-- billing_course_id NULL = the whole program (same convention as
-- application_segment_choices, 221). The dates are a snapshot taken when
-- the stay was last worked out, so a later change to the school's dates
-- shows up as a difference. start/end/arrival come from billing_courses;
-- departure_date lives only here, on the case (billing_courses is the
-- shared course calendar and gets no departure column). School leaders who hold visas.follow_up for
-- one of these programs follow the case up (see 361).
CREATE TABLE IF NOT EXISTS public.visa_case_schools (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id            uuid NOT NULL REFERENCES public.visa_cases(id) ON DELETE CASCADE,
  program_id         uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  billing_course_id  uuid REFERENCES public.billing_courses(id) ON DELETE SET NULL,
  application_id     uuid REFERENCES public.application_responses(id) ON DELETE SET NULL,
  start_date         date,
  end_date           date,
  arrival_date       date,
  departure_date     date,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS visa_case_schools_unique
  ON public.visa_case_schools (
    case_id,
    program_id,
    coalesce(billing_course_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
CREATE INDEX IF NOT EXISTS idx_visa_case_schools_program ON public.visa_case_schools (program_id);

-- ────────────────────────────────────────────────────────────
-- 5. CASE DOCUMENTS — one row per upload (or per ticked offline step)
-- ────────────────────────────────────────────────────────────
-- A redo adds a new row; the newest row per (case, type) counts.
CREATE TABLE IF NOT EXISTS public.visa_case_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id           uuid NOT NULL REFERENCES public.visa_cases(id) ON DELETE RESTRICT,
  document_type_id  uuid NOT NULL REFERENCES public.visa_document_types(id) ON DELETE RESTRICT,
  storage_path      text,
  mime_type         text,
  size_bytes        integer CHECK (size_bytes IS NULL OR size_bytes > 0),
  issued_on         date,
  status            text NOT NULL DEFAULT 'uploaded'
                    CHECK (status IN ('uploaded', 'approved', 'needs_redo', 'ticked')),
  review_note       text,
  uploaded_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- The file is always '<this row's case_id>/<this row's id>.<ext>', so a
  -- row can only ever point at its own file, never another case's. The
  -- id and case_id are uuids, so they hold no regex characters.
  CONSTRAINT visa_case_documents_own_path CHECK (
    storage_path IS NULL
    OR storage_path ~ ('^' || case_id::text || '/' || id::text || '\.[a-z0-9]{2,5}$')
  ),
  -- A ticked offline step has no file; everything else has one.
  CONSTRAINT visa_case_documents_file_or_tick CHECK (
    (status = 'ticked') = (storage_path IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_visa_case_documents_case
  ON public.visa_case_documents (case_id, document_type_id, created_at DESC);

-- ────────────────────────────────────────────────────────────
-- 6. APPROVAL REQUESTS — school leader → legal
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.visa_approval_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id       uuid NOT NULL REFERENCES public.visa_cases(id) ON DELETE CASCADE,
  requested_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  leader_note   text,
  decision      text CHECK (decision IS NULL OR decision IN ('approved', 'sent_back')),
  decided_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  legal_note    text,
  CONSTRAINT visa_approval_requests_decided CHECK ((decision IS NULL) = (decided_at IS NULL))
);

-- One undecided request per case at a time.
CREATE UNIQUE INDEX IF NOT EXISTS visa_approval_requests_one_open
  ON public.visa_approval_requests (case_id)
  WHERE decision IS NULL;

-- ────────────────────────────────────────────────────────────
-- 7. QUESTIONS — "Ask legal" threads (serious matters only)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.visa_case_questions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      uuid NOT NULL REFERENCES public.visa_cases(id) ON DELETE CASCADE,
  asked_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  question     text NOT NULL CHECK (length(btrim(question)) > 0),
  answer       text,
  answered_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  answered_at  timestamptz,
  closed_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visa_case_questions_open
  ON public.visa_case_questions (case_id)
  WHERE closed_at IS NULL;

-- ────────────────────────────────────────────────────────────
-- 8. EVENTS — append-only audit log
-- ────────────────────────────────────────────────────────────
-- Status changes, reviews, requests, messages sent and every document
-- download. detail must never hold a passport number or file contents.
CREATE TABLE IF NOT EXISTS public.visa_case_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid NOT NULL REFERENCES public.visa_cases(id) ON DELETE RESTRICT,
  actor_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind ~ '^[a-z_]+$'),
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visa_case_events_case
  ON public.visa_case_events (case_id, created_at DESC);

-- ────────────────────────────────────────────────────────────
-- 9. UPDATED_AT TRIGGERS
-- ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS set_updated_at ON public.visa_country_rules;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.visa_country_rules
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.visa_document_types;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.visa_document_types
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.visa_cases;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.visa_cases
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ────────────────────────────────────────────────────────────
-- 10. LOCKED COLUMNS — for every role, the service role and definer
--     functions included
-- ────────────────────────────────────────────────────────────
-- A document row's id, case, type and file never change after insert: a
-- redo is a new row. Together with the own-path CHECK above, no row can
-- be repointed at another case's file.
CREATE OR REPLACE FUNCTION public.visa_case_documents_locked()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.case_id IS DISTINCT FROM OLD.case_id
     OR NEW.document_type_id IS DISTINCT FROM OLD.document_type_id
     OR NEW.storage_path IS DISTINCT FROM OLD.storage_path THEN
    RAISE EXCEPTION 'A document''s case, type and file can''t be changed; upload a new one'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS visa_case_documents_locked ON public.visa_case_documents;
CREATE TRIGGER visa_case_documents_locked BEFORE UPDATE ON public.visa_case_documents
  FOR EACH ROW EXECUTE FUNCTION public.visa_case_documents_locked();

-- A case row never moves to another case. Who a case is for, and which
-- school a stay row is for, change only by global legal (visa_is_legal,
-- 361), never by legal scoped to one school: that would let them pull
-- another school's student into a case they manage.
CREATE OR REPLACE FUNCTION public.visa_case_owner_locked()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'visa_cases' THEN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'A case''s id can''t change' USING ERRCODE = '42501';
    END IF;
    IF NEW.user_id IS DISTINCT FROM OLD.user_id AND NOT public.visa_is_legal() THEN
      RAISE EXCEPTION 'Only global legal can change who a case is for' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.case_id IS DISTINCT FROM OLD.case_id THEN
      RAISE EXCEPTION 'A school can''t move to another case' USING ERRCODE = '42501';
    END IF;
    IF NEW.program_id IS DISTINCT FROM OLD.program_id AND NOT public.visa_is_legal() THEN
      RAISE EXCEPTION 'Only global legal can change a case''s school' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
-- visa_is_legal() is created in 361; plpgsql resolves it when the trigger
-- first runs, and 360 and 361 apply together.

DROP TRIGGER IF EXISTS visa_cases_owner_locked ON public.visa_cases;
CREATE TRIGGER visa_cases_owner_locked BEFORE UPDATE ON public.visa_cases
  FOR EACH ROW EXECUTE FUNCTION public.visa_case_owner_locked();

DROP TRIGGER IF EXISTS visa_case_schools_owner_locked ON public.visa_case_schools;
CREATE TRIGGER visa_case_schools_owner_locked BEFORE UPDATE ON public.visa_case_schools
  FOR EACH ROW EXECUTE FUNCTION public.visa_case_owner_locked();

-- Cases aren't deleted: documents, the event log and the student's user
-- row all RESTRICT, so the history and the files can't vanish by cascade.
-- A finished case is closed or withdrawn instead. Removing a case after
-- the retention period is a deliberate job (build step 4) that deletes
-- the files first.

COMMIT;
