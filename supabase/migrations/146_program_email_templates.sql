-- ============================================================
-- FFSA Hub — Migration 146: per-program email templates
-- ============================================================
-- Lets a school's leaders (migration 145) control the student-facing
-- emails in their application process: turn each one on/off and rewrite
-- its subject + body, with {{first_name}} / {{program_name}} merge
-- fields. The system still wraps the body in FFSA branding and appends
-- the required action button, so a leader controls the words without
-- being able to break the email.
--
-- One row per (program, email_type). No row = the built-in default
-- (current hardcoded copy). email_type is validated in app code against
-- the catalog in src/lib/email/program-email-types.ts, not by a DB CHECK,
-- so adding a new overridable email later needs no migration.
--
-- The acceptance / enrollment email is deliberately NOT managed here — it
-- keeps its existing dedicated editor (programs.acceptance_email_subject/
-- body, migration 035) under the Application tab.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.program_email_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id  uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  email_type  text NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  subject     text,           -- null = use the default subject
  body        text,           -- null = use the default body (plain text + merge fields)
  updated_by  uuid REFERENCES public.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, email_type)
);

CREATE INDEX IF NOT EXISTS program_email_templates_program_idx
  ON public.program_email_templates (program_id);

CREATE OR REPLACE FUNCTION public.touch_program_email_templates_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_program_email_templates_updated_at
  ON public.program_email_templates;
CREATE TRIGGER trg_program_email_templates_updated_at
  BEFORE UPDATE ON public.program_email_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_program_email_templates_updated_at();

-- RLS: a school's leaders (and admins / global schools managers) read and
-- manage that school's templates — the exact set has_schools_access(
-- program_id) returns, which migration 145 extended to include leaders.
ALTER TABLE public.program_email_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read program email templates" ON public.program_email_templates;
CREATE POLICY "Read program email templates"
  ON public.program_email_templates FOR SELECT
  USING (public.has_schools_access(program_id));

DROP POLICY IF EXISTS "Manage program email templates" ON public.program_email_templates;
CREATE POLICY "Manage program email templates"
  ON public.program_email_templates FOR ALL
  USING (public.has_schools_access(program_id))
  WITH CHECK (public.has_schools_access(program_id));

COMMENT ON TABLE public.program_email_templates IS
  'Per-program overrides for student-facing application emails: enabled/subject/body per email_type. No row = built-in default. Managed by the program''s leaders via has_schools_access(program_id).';

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   SELECT policyname FROM pg_policies WHERE tablename = 'program_email_templates';
-- ============================================================
