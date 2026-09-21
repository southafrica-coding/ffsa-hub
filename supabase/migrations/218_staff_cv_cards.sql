-- ============================================================
-- FFSA Hub — Migration 218: Staff CV / personal card
-- ------------------------------------------------------------
-- Every staff member gets a personal "CV" card: an essence statement
-- plus repeatable entries (past involvement, training, skills, other).
-- Staff self-report their own card; the Leadership Team may ALSO add
-- entries that only Leadership Team can add or remove (visible to
-- everyone who can see the card, but not editable by the staff member
-- or their ministry leader) — e.g. a skill leadership wants recognized.
--
-- RLS stays minimal (self + admin), matching the household_members
-- precedent and the project's rule against widening RLS for personal
-- data: leadership_team / ministry_leader reads, and the Leadership
-- Team write path, go through the service-role client with explicit
-- TS checks in src/lib/auth/check-cv-access.ts — same pattern as the
-- program-leader read in src/app/(admin)/users/[id]/page.tsx.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Essence statement — a singleton free-text field on users.
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS essence_statement text;

-- ────────────────────────────────────────────────────────────
-- 2. Repeatable CV entries.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_cv_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  category       text NOT NULL CHECK (category IN ('involvement', 'training', 'skill', 'other')),
  title          text NOT NULL,
  description    text,
  -- Who may add/edit/remove this entry: 'self' = the card owner (or admin);
  -- 'leadership' = any Leadership Team member (or admin) only — the owner
  -- and their ministry leader can see it but not touch it.
  added_by_role  text NOT NULL DEFAULT 'self' CHECK (added_by_role IN ('self', 'leadership')),
  created_by     uuid NOT NULL REFERENCES public.users (id),
  sort_order     int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_cv_entries_user_idx
  ON public.staff_cv_entries (user_id);

DROP TRIGGER IF EXISTS trg_staff_cv_entries_updated_at ON public.staff_cv_entries;
CREATE TRIGGER trg_staff_cv_entries_updated_at
  BEFORE UPDATE ON public.staff_cv_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ────────────────────────────────────────────────────────────
-- 3. RLS — self manages their own 'self'-scope rows; self may also
--    plain-read their own 'leadership'-scope rows (visible, not
--    editable). Admin has full access. Cross-user reads and the
--    Leadership Team write path are handled in application code via
--    the service-role client (see header note above).
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.staff_cv_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own cv entries" ON public.staff_cv_entries;
CREATE POLICY "Users read own cv entries"
  ON public.staff_cv_entries FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Users insert own self-scope cv entries" ON public.staff_cv_entries;
CREATE POLICY "Users insert own self-scope cv entries"
  ON public.staff_cv_entries FOR INSERT
  WITH CHECK (user_id = auth.uid() AND added_by_role = 'self');

DROP POLICY IF EXISTS "Users update own self-scope cv entries" ON public.staff_cv_entries;
CREATE POLICY "Users update own self-scope cv entries"
  ON public.staff_cv_entries FOR UPDATE
  USING (user_id = auth.uid() AND added_by_role = 'self')
  WITH CHECK (user_id = auth.uid() AND added_by_role = 'self');

DROP POLICY IF EXISTS "Users delete own self-scope cv entries" ON public.staff_cv_entries;
CREATE POLICY "Users delete own self-scope cv entries"
  ON public.staff_cv_entries FOR DELETE
  USING (user_id = auth.uid() AND added_by_role = 'self');

DROP POLICY IF EXISTS "Admins manage cv entries" ON public.staff_cv_entries;
CREATE POLICY "Admins manage cv entries"
  ON public.staff_cv_entries FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   ALTER TABLE public.users ...  -- confirm essence_statement exists:
--   SELECT essence_statement FROM public.users LIMIT 1;
--
--   INSERT INTO public.staff_cv_entries (user_id, category, title, added_by_role, created_by)
--   VALUES ('<uuid>', 'skill', 'Worship leading', 'self', '<uuid>');
--   SELECT * FROM public.staff_cv_entries WHERE user_id = '<uuid>';
--   -- as another (non-admin) user, the row must NOT be visible (RLS).
-- ============================================================
