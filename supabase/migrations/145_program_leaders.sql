-- ============================================================
-- FFSA Hub — Migration 145: program (school) leader teams
-- ============================================================
-- Most schools are led by a TEAM, not one owner. This adds a
-- many-to-many program ↔ user table so any number of people can be
-- named leaders of a school, and makes that membership a first-class
-- access grant: being a leader of a program gives you the same
-- program-scoped schools access the RLS layer already checks via
-- has_schools_access(program_id).
--
-- That single wiring means a named leader can manage their school
-- (program, courses, applications, and — next PR — its email
-- templates) without needing a global schools role. Leaders of one
-- school get no access to another.
--
-- Idempotent: guarded CREATEs. Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.program_leaders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id  uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  added_by    uuid REFERENCES public.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, user_id)
);

CREATE INDEX IF NOT EXISTS program_leaders_program_idx
  ON public.program_leaders (program_id);
CREATE INDEX IF NOT EXISTS program_leaders_user_idx
  ON public.program_leaders (user_id);

COMMENT ON TABLE public.program_leaders IS
  'Team of leaders for a school (program). Membership grants program-scoped schools access via has_schools_access(program_id). Many leaders per program.';

-- ────────────────────────────────────────────────────────────
-- Access helper. SECURITY DEFINER so the internal read bypasses RLS
-- (and so the program_leaders policies below can call it without
-- recursing through their own USING clause).
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_program_leader(target_program_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.program_leaders
    WHERE program_id = target_program_id
      AND user_id = auth.uid()
  );
$$;

-- Fold leadership into the existing scoped schools-access check (was
-- migration 040). Admins and global schools managers keep their access;
-- named leaders now gain it for their own program only.
CREATE OR REPLACE FUNCTION public.has_schools_access(target_program_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
      OR public.has_permission_for('schools.manage', target_program_id)
      OR public.is_program_leader(target_program_id);
$$;

-- ────────────────────────────────────────────────────────────
-- RLS. Read: anyone with schools access to the program (which now
-- includes its own leaders) plus the leader themselves. Manage: the
-- same schools-access set — so an admin, a global schools manager, OR
-- an existing leader can grow / prune the team (self-managing teams).
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.program_leaders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read program leaders" ON public.program_leaders;
CREATE POLICY "Read program leaders"
  ON public.program_leaders FOR SELECT
  USING (
    public.has_schools_access(program_id)
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Manage program leaders" ON public.program_leaders;
CREATE POLICY "Manage program leaders"
  ON public.program_leaders FOR ALL
  USING (public.has_schools_access(program_id))
  WITH CHECK (public.has_schools_access(program_id));

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   SELECT public.has_schools_access('<program uuid>');  -- as a leader → true
--   SELECT policyname FROM pg_policies WHERE tablename = 'program_leaders';
-- ============================================================
