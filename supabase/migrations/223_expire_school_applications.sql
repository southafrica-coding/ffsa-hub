-- ============================================================
-- FFSA Hub — Migration 223: Expire school applications 6 months after
-- the school ends
-- ============================================================
-- Six months after a school's last course ends, its submitted applications
-- (and their references) are locked down. Only super admins and the
-- Training Team (the "Training Team" category inside the Training staff
-- ministry) can still read or change them.
--
-- Decisions (confirmed with the product owner):
--   * Only applications + references are hidden. The school itself stays
--     visible in lists and history.
--   * Applicants are unaffected: user_id = auth.uid() and the status-token
--     page (admin client) keep working.
--   * Fixed 6-month window, no per-school override.
--   * General `admin`, program leaders, schools.* grant holders and
--     assigned staff are all locked out once expired.
--   * End date = latest billing_courses.end_date for the program
--     (programs has no dates of its own). No dated courses → never expires.
--   * The Training Team is matched by category NAME (case-insensitive)
--     under the ministry with slug 'training'. Renaming the category locks
--     the team out (fails closed) — keep the name "Training Team".
--
-- While rewriting the reference_requests policies, the unscoped
-- has_schools_access() (migration 023) is replaced with the scoped
-- has_schools_access(program_id), so a one-school grant no longer reads
-- every school's references.
--
-- Mirrored in TS by src/lib/auth/application-expiry.ts.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Helpers
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.program_end_date(pid uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT max(end_date) FROM public.billing_courses WHERE program_id = pid;
$$;

CREATE OR REPLACE FUNCTION public.program_applications_expired(pid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    public.program_end_date(pid) + interval '6 months' < current_date,
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.is_training_team_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_ministry_member_subcategories x
    JOIN public.staff_ministry_members mm ON mm.id = x.membership_id
    JOIN public.staff_ministry_subcategories c ON c.id = x.subcategory_id
    JOIN public.staff_ministries m ON m.id = c.staff_ministry_id
    WHERE mm.user_id = auth.uid()
      AND m.slug = 'training'
      AND lower(c.name) = 'training team'
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_expired_applications()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_any_role(ARRAY['super_admin'])
      OR public.is_training_team_member();
$$;

-- Single gate used by every policy below: the normal rule applies while the
-- school is live; once expired only the privileged set gets through.
CREATE OR REPLACE FUNCTION public.application_gate(pid uuid, normal_access boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.program_applications_expired(pid)
      THEN public.can_access_expired_applications()
    ELSE coalesce(normal_access, false)
  END;
$$;

-- ────────────────────────────────────────────────────────────
-- 2. application_responses
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Schools managers can read all application responses" ON public.application_responses;
CREATE POLICY "Schools managers can read all application responses"
  ON public.application_responses FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.application_gate(
      program_id,
      public.has_schools_access(program_id)
      OR public.has_permission_for('schools.view_applications', program_id)
      OR public.has_permission_for('schools.approve_applications', program_id)
    )
  );

DROP POLICY IF EXISTS "Assigned staff can read their application_responses" ON public.application_responses;
CREATE POLICY "Assigned staff can read their application_responses"
  ON public.application_responses FOR SELECT
  USING (public.application_gate(program_id, assigned_staff_id = auth.uid()));

DROP POLICY IF EXISTS "Schools managers can update application responses" ON public.application_responses;
CREATE POLICY "Schools managers can update application responses"
  ON public.application_responses FOR UPDATE
  USING (
    public.application_gate(
      program_id,
      public.has_schools_access(program_id)
      OR public.has_permission_for('schools.approve_applications', program_id)
    )
  )
  WITH CHECK (
    public.application_gate(
      program_id,
      public.has_schools_access(program_id)
      OR public.has_permission_for('schools.approve_applications', program_id)
    )
  );

DROP POLICY IF EXISTS "Schools managers can delete application responses" ON public.application_responses;
CREATE POLICY "Schools managers can delete application responses"
  ON public.application_responses FOR DELETE
  USING (
    public.application_gate(
      program_id,
      public.has_schools_access() OR public.has_permission('schools.approve_applications')
    )
  );

-- ────────────────────────────────────────────────────────────
-- 3. reference_requests (gated via the parent application's program)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reference_request_access(app_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((
    SELECT public.application_gate(ar.program_id, public.has_schools_access(ar.program_id))
    FROM public.application_responses ar
    WHERE ar.id = app_id
  ), false);
$$;

DROP POLICY IF EXISTS "Schools managers can read all reference requests" ON public.reference_requests;
CREATE POLICY "Schools managers can read all reference requests"
  ON public.reference_requests FOR SELECT
  USING (public.reference_request_access(application_id));

DROP POLICY IF EXISTS "Schools managers can insert reference requests" ON public.reference_requests;
CREATE POLICY "Schools managers can insert reference requests"
  ON public.reference_requests FOR INSERT
  WITH CHECK (public.reference_request_access(application_id));

DROP POLICY IF EXISTS "Schools managers can update reference requests" ON public.reference_requests;
CREATE POLICY "Schools managers can update reference requests"
  ON public.reference_requests FOR UPDATE
  USING (public.reference_request_access(application_id))
  WITH CHECK (public.reference_request_access(application_id));

-- "Users can read own reference requests" (021) is deliberately untouched.

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   SELECT p.name, public.program_end_date(p.id),
--          public.program_applications_expired(p.id)
--     FROM public.programs p ORDER BY 2 NULLS FIRST;
--
--   -- impersonate a user inside a transaction:
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   SELECT set_config('request.jwt.claims', '{"sub":"<user uuid>"}', true);
--   SELECT public.is_training_team_member(), public.can_access_expired_applications();
--   SELECT program_id, count(*) FROM public.application_responses GROUP BY 1;
--   ROLLBACK;
-- ============================================================
