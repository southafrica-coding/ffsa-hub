-- ============================================================
-- FFSA Hub — Migration 305: schools LMS content (slice 1)
-- ============================================================
-- DO NOT APPLY until Jack says so. Not applied to prod or any shared
-- Supabase project yet.
--
-- The smallest classroom skeleton for a school: courses → modules →
-- lessons. A lesson is rich text or an external link. Each level has a
-- published flag; students and program staff only see a lesson when the
-- lesson, its module, and its course are all published.
--
-- These are new lms_* tables. They do not read or write billing_courses
-- (the school's phase / billing "Courses" tab), grades, the fee tables,
-- or the legacy academic public.courses table.
--
-- Who can do what (mirrors the app layer in src/services/lms-content.ts):
--   • Edit (insert / update / delete, and read drafts):
--       can_manage_program_applications(program) OR has_schools_access(program)
--     — admins, named leaders, schools.manage / approve_applications /
--       manage_enrollments (global or this program), program_leader role.
--   • Read published content only:
--       is_program_staff(program), or an enrolled student of the program
--       (enrollments.user_id = auth.uid(), removed_at IS NULL, status not
--       dismissed / decided_to_leave).
--   • Everyone else: nothing. anon has no grants.
--
-- No new permission keys. Idempotent. Safe to re-run.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Tables
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lms_courses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id   uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  title        text NOT NULL,
  description  text,
  sort_order   int  NOT NULL DEFAULT 0,
  published    boolean NOT NULL DEFAULT false,
  created_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lms_modules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  title        text NOT NULL,
  sort_order   int  NOT NULL DEFAULT 0,
  published    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lms_lessons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id     uuid NOT NULL REFERENCES public.lms_modules(id) ON DELETE CASCADE,
  title         text NOT NULL,
  content_type  text NOT NULL CHECK (content_type IN ('rich_text', 'link')),
  body          text,
  link_url      text,
  sort_order    int  NOT NULL DEFAULT 0,
  published     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lms_lessons_content_check CHECK (
    (content_type = 'rich_text' AND body IS NOT NULL)
    OR (content_type = 'link' AND link_url IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS lms_courses_program_idx
  ON public.lms_courses (program_id);
CREATE INDEX IF NOT EXISTS lms_courses_program_sort_idx
  ON public.lms_courses (program_id, sort_order);
CREATE INDEX IF NOT EXISTS lms_courses_created_by_idx
  ON public.lms_courses (created_by);
CREATE INDEX IF NOT EXISTS lms_modules_course_idx
  ON public.lms_modules (course_id);
CREATE INDEX IF NOT EXISTS lms_modules_course_sort_idx
  ON public.lms_modules (course_id, sort_order);
CREATE INDEX IF NOT EXISTS lms_lessons_module_idx
  ON public.lms_lessons (module_id);
CREATE INDEX IF NOT EXISTS lms_lessons_module_sort_idx
  ON public.lms_lessons (module_id, sort_order);

COMMENT ON TABLE public.lms_courses IS
  'Classroom course for one school (LMS slice 1). Not billing_courses and not the legacy public.courses table.';
COMMENT ON TABLE public.lms_modules IS
  'Ordered module inside an lms_courses row.';
COMMENT ON TABLE public.lms_lessons IS
  'Ordered lesson inside an lms_modules row: rich_text (body) or link (link_url).';

DROP TRIGGER IF EXISTS set_updated_at ON public.lms_courses;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.lms_courses
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON public.lms_modules;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.lms_modules
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON public.lms_lessons;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.lms_lessons
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ────────────────────────────────────────────────────────────
-- 2. Access helpers
-- ────────────────────────────────────────────────────────────
-- SECURITY DEFINER so the module / lesson policies can look up the
-- owning course without recursing through lms_courses RLS.

CREATE OR REPLACE FUNCTION public.lms_can_edit(target_program_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.can_manage_program_applications(target_program_id)
      OR public.has_schools_access(target_program_id);
$$;

CREATE OR REPLACE FUNCTION public.lms_is_enrolled(target_program_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.enrollments e
     WHERE e.program_id = target_program_id
       AND e.user_id = auth.uid()
       AND e.removed_at IS NULL
       AND e.status NOT IN ('dismissed', 'decided_to_leave')
  );
$$;

CREATE OR REPLACE FUNCTION public.lms_can_read_published(target_program_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_program_staff(target_program_id)
      OR public.lms_is_enrolled(target_program_id);
$$;

-- Course-level checks, by course id.
CREATE OR REPLACE FUNCTION public.lms_course_editable(target_course_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lms_courses c
     WHERE c.id = target_course_id
       AND public.lms_can_edit(c.program_id)
  );
$$;

-- Readable as published content: the course itself is published.
CREATE OR REPLACE FUNCTION public.lms_course_published_readable(target_course_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lms_courses c
     WHERE c.id = target_course_id
       AND c.published
       AND public.lms_can_read_published(c.program_id)
  );
$$;

-- Module-level checks, by module id.
CREATE OR REPLACE FUNCTION public.lms_module_editable(target_module_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.lms_modules m
      JOIN public.lms_courses c ON c.id = m.course_id
     WHERE m.id = target_module_id
       AND public.lms_can_edit(c.program_id)
  );
$$;

-- Readable as published content: the module and its course are published.
CREATE OR REPLACE FUNCTION public.lms_module_published_readable(target_module_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.lms_modules m
      JOIN public.lms_courses c ON c.id = m.course_id
     WHERE m.id = target_module_id
       AND m.published
       AND c.published
       AND public.lms_can_read_published(c.program_id)
  );
$$;

REVOKE ALL ON FUNCTION public.lms_can_edit(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lms_is_enrolled(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lms_can_read_published(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lms_course_editable(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lms_course_published_readable(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lms_module_editable(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lms_module_published_readable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lms_can_edit(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lms_is_enrolled(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lms_can_read_published(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lms_course_editable(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lms_course_published_readable(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lms_module_editable(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lms_module_published_readable(uuid) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 3. Grants
-- ────────────────────────────────────────────────────────────
REVOKE ALL ON public.lms_courses FROM anon;
REVOKE ALL ON public.lms_modules FROM anon;
REVOKE ALL ON public.lms_lessons FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lms_courses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lms_modules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lms_lessons TO authenticated;
GRANT ALL ON public.lms_courses TO service_role;
GRANT ALL ON public.lms_modules TO service_role;
GRANT ALL ON public.lms_lessons TO service_role;

-- ────────────────────────────────────────────────────────────
-- 4. RLS
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.lms_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_lessons ENABLE ROW LEVEL SECURITY;

-- Courses
DROP POLICY IF EXISTS "LMS courses: editors read all, others read published" ON public.lms_courses;
CREATE POLICY "LMS courses: editors read all, others read published"
  ON public.lms_courses FOR SELECT TO authenticated
  USING (
    public.lms_can_edit(program_id)
    OR (published AND public.lms_can_read_published(program_id))
  );

DROP POLICY IF EXISTS "LMS courses: editors insert" ON public.lms_courses;
CREATE POLICY "LMS courses: editors insert"
  ON public.lms_courses FOR INSERT TO authenticated
  WITH CHECK (public.lms_can_edit(program_id));

DROP POLICY IF EXISTS "LMS courses: editors update" ON public.lms_courses;
CREATE POLICY "LMS courses: editors update"
  ON public.lms_courses FOR UPDATE TO authenticated
  USING (public.lms_can_edit(program_id))
  WITH CHECK (public.lms_can_edit(program_id));

DROP POLICY IF EXISTS "LMS courses: editors delete" ON public.lms_courses;
CREATE POLICY "LMS courses: editors delete"
  ON public.lms_courses FOR DELETE TO authenticated
  USING (public.lms_can_edit(program_id));

-- Modules
DROP POLICY IF EXISTS "LMS modules: editors read all, others read published" ON public.lms_modules;
CREATE POLICY "LMS modules: editors read all, others read published"
  ON public.lms_modules FOR SELECT TO authenticated
  USING (
    public.lms_course_editable(course_id)
    OR (published AND public.lms_course_published_readable(course_id))
  );

DROP POLICY IF EXISTS "LMS modules: editors insert" ON public.lms_modules;
CREATE POLICY "LMS modules: editors insert"
  ON public.lms_modules FOR INSERT TO authenticated
  WITH CHECK (public.lms_course_editable(course_id));

DROP POLICY IF EXISTS "LMS modules: editors update" ON public.lms_modules;
CREATE POLICY "LMS modules: editors update"
  ON public.lms_modules FOR UPDATE TO authenticated
  USING (public.lms_course_editable(course_id))
  WITH CHECK (public.lms_course_editable(course_id));

DROP POLICY IF EXISTS "LMS modules: editors delete" ON public.lms_modules;
CREATE POLICY "LMS modules: editors delete"
  ON public.lms_modules FOR DELETE TO authenticated
  USING (public.lms_course_editable(course_id));

-- Lessons
DROP POLICY IF EXISTS "LMS lessons: editors read all, others read published" ON public.lms_lessons;
CREATE POLICY "LMS lessons: editors read all, others read published"
  ON public.lms_lessons FOR SELECT TO authenticated
  USING (
    public.lms_module_editable(module_id)
    OR (published AND public.lms_module_published_readable(module_id))
  );

DROP POLICY IF EXISTS "LMS lessons: editors insert" ON public.lms_lessons;
CREATE POLICY "LMS lessons: editors insert"
  ON public.lms_lessons FOR INSERT TO authenticated
  WITH CHECK (public.lms_module_editable(module_id));

DROP POLICY IF EXISTS "LMS lessons: editors update" ON public.lms_lessons;
CREATE POLICY "LMS lessons: editors update"
  ON public.lms_lessons FOR UPDATE TO authenticated
  USING (public.lms_module_editable(module_id))
  WITH CHECK (public.lms_module_editable(module_id));

DROP POLICY IF EXISTS "LMS lessons: editors delete" ON public.lms_lessons;
CREATE POLICY "LMS lessons: editors delete"
  ON public.lms_lessons FOR DELETE TO authenticated
  USING (public.lms_module_editable(module_id));
