-- ============================================================
-- FFSA Hub — Migration 321: Department budget links
-- ============================================================
-- Depends on 290 (finance_projects) and 318.
--
-- public.department_budget_links is one finance project on a staff
-- ministry, plus the figures. Columns the department API selects:
--   id, staff_ministry_id, finance_project_id, budget_cents, spend_cents,
--   currency, notes, updated_at, updated_by.
-- finance_project_id is nullable. budget_cents and spend_cents are
-- bigint cents (0 until someone sets them). currency is ZAR only,
-- matching the South Africa lock in PR #475. USA-org projects are
-- not seeded. A department can have several ZAR links; there is no
-- unique constraint on staff_ministry_id alone.
--
-- year is an extra column. It defaults to the calendar year of the
-- INSERT (EXTRACT(YEAR FROM CURRENT_DATE)), so a row written in 2026
-- without a year lands in 2026. The API does not filter on it. A second
-- paste does not open another year for the same ministry and project:
-- the unique key is (staff_ministry_id, finance_project_id), not the year.
--
-- Seeded links are exact name matches only, with budget_cents 0 and
-- spend_cents 0. Zero means "linked, no figure set", not a budget
-- someone approved. "Exact" is lower(btrim(name)) on both sides, and
-- the ministry name must be unique. HULC matches the project named
-- HULC and does not match HULC Merch. The same name in FFSA NPC and
-- FF USA Inc is two rows, not a guess between two different names.
-- Prayer & Worship does not match Worship & Prayer. No finance_projects
-- row is updated.
--
-- The join is staff_ministries.name to finance_projects.name. It does
-- not look at okr_teams or the booking palette. Hope Again and Brave
-- Love are finance projects (and OKR teams; Brave Love is also a booking
-- ministry). No migration inserts a staff ministry with either name, so
-- this file does not link them. It would link one only if that exact
-- staff-ministry name were already in the table.
-- Matches from the names migrations do insert:
--   HULC, Media, Project 54, Woven — NPC and USA, where both exist.
--   Woven is inactive and still matches, because the names are equal.
-- Not matched, on purpose:
--   Hope Again; Brave Love;
--   HULC Merch; Worship & Prayer; the Missio JHB/Potch/base rows;
--   1040 Crossfit; EFL / EFLTanz / EFL 2026 / Educating for Life;
--   Rooted and the Redwood academy names;
--   Operations, Training, Events, Leadership Team, Finances & Legal,
--   Donors & Dev, Be Free, No Ministry, Inside Ministry, Outside Ministry;
--   buildings, camps, events and the General * rows.
--
-- Read: an active admin, an unscoped finance.view or finance.edit grant,
-- the unscoped finance_admin role, an active Finances & Legal member,
-- or the leader of THAT ministry. A program-scoped finance grant does
-- not count. Write: the ministry's leader, or an admin. Finance reads
-- and does not edit. A plain member and any inactive account get nothing.
-- Leadership Team membership alone does not read a budget.
-- Wrapped in one transaction.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.department_budget_links (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_ministry_id  uuid NOT NULL REFERENCES public.staff_ministries (id) ON DELETE CASCADE,
  finance_project_id uuid REFERENCES public.finance_projects (id) ON DELETE SET NULL,
  budget_cents       bigint NOT NULL DEFAULT 0 CHECK (budget_cents >= 0),
  spend_cents        bigint NOT NULL DEFAULT 0 CHECK (spend_cents >= 0),
  currency           text NOT NULL DEFAULT 'ZAR' CHECK (currency = 'ZAR'),
  notes              text,
  -- Calendar year of the insert when the writer omits it. The API ignores it.
  year               integer NOT NULL DEFAULT (EXTRACT(YEAR FROM CURRENT_DATE)::integer)
                       CHECK (year BETWEEN 2000 AND 2100),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS department_budget_links_ministry_project_key
  ON public.department_budget_links (staff_ministry_id, finance_project_id)
  WHERE finance_project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS department_budget_links_ministry_idx
  ON public.department_budget_links (staff_ministry_id);
CREATE INDEX IF NOT EXISTS department_budget_links_finance_project_id_idx
  ON public.department_budget_links (finance_project_id);
CREATE INDEX IF NOT EXISTS department_budget_links_updated_by_idx
  ON public.department_budget_links (updated_by);

COMMENT ON TABLE public.department_budget_links IS
  'A staff ministry''s finance project, with budget and spend in cents. year defaults to the calendar year of the insert and is not read by the department API.';
COMMENT ON COLUMN public.department_budget_links.year IS
  'Defaults to EXTRACT(YEAR FROM CURRENT_DATE) at insert. Not part of the API contract.';
COMMENT ON COLUMN public.department_budget_links.budget_cents IS
  'Integer cents. 0 on a seeded name match means no figure has been set.';

DROP TRIGGER IF EXISTS set_updated_at ON public.department_budget_links;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.department_budget_links
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Unscoped grant only. Does not consult has_permission, so a scoped
-- finance.* grant cannot leak in on a database that is still on 313.
CREATE OR REPLACE FUNCTION public.dept_holds_unscoped_permission(required_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_permissions up
      JOIN public.permissions p ON p.id = up.permission_id
     WHERE up.user_id = auth.uid()
       AND p.key = required_permission
       AND up.scope_type IS NULL
  )
  OR EXISTS (
    SELECT 1
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = auth.uid()
       AND p.key = required_permission
       AND ur.scope_type IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.dept_can_read_budget(p_ministry_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.dept_caller_is_active()
     AND (
       public.is_admin()
       OR public.has_role('finance_admin')
       OR public.dept_holds_unscoped_permission('finance.view')
       OR public.dept_holds_unscoped_permission('finance.edit')
       OR EXISTS (
         SELECT 1
           FROM public.staff_ministry_members mm
           JOIN public.staff_ministries sm ON sm.id = mm.staff_ministry_id
          WHERE sm.slug = 'finances_legal'
            AND mm.user_id = auth.uid()
            AND mm.status = 'active'
       )
       OR public.dept_is_ministry_leader(p_ministry_id)
     );
$$;

CREATE OR REPLACE FUNCTION public.dept_can_write_budget(p_ministry_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.dept_caller_is_active()
     AND (
       public.is_admin()
       OR public.dept_is_ministry_leader(p_ministry_id)
     );
$$;

REVOKE ALL ON FUNCTION public.dept_holds_unscoped_permission(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dept_can_read_budget(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dept_can_write_budget(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dept_holds_unscoped_permission(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dept_can_read_budget(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dept_can_write_budget(uuid) TO authenticated, service_role;

ALTER TABLE public.department_budget_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.department_budget_links FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.department_budget_links TO authenticated, service_role;

DROP POLICY IF EXISTS "Finance and leaders read department budgets" ON public.department_budget_links;
CREATE POLICY "Finance and leaders read department budgets"
  ON public.department_budget_links FOR SELECT TO authenticated
  USING (public.dept_can_read_budget(staff_ministry_id));

DROP POLICY IF EXISTS "Leaders insert department budgets" ON public.department_budget_links;
CREATE POLICY "Leaders insert department budgets"
  ON public.department_budget_links FOR INSERT TO authenticated
  WITH CHECK (public.dept_can_write_budget(staff_ministry_id));

DROP POLICY IF EXISTS "Leaders update department budgets" ON public.department_budget_links;
CREATE POLICY "Leaders update department budgets"
  ON public.department_budget_links FOR UPDATE TO authenticated
  USING (public.dept_can_write_budget(staff_ministry_id))
  WITH CHECK (public.dept_can_write_budget(staff_ministry_id));

DROP POLICY IF EXISTS "Leaders delete department budgets" ON public.department_budget_links;
CREATE POLICY "Leaders delete department budgets"
  ON public.department_budget_links FOR DELETE TO authenticated
  USING (public.dept_can_write_budget(staff_ministry_id));

-- Exact name matches on the South Africa org only. budget and spend stay 0.
INSERT INTO public.department_budget_links (
  staff_ministry_id, finance_project_id, budget_cents, spend_cents, currency, notes
)
SELECT sm.id, fp.id, 0, 0, 'ZAR', 'Exact name match. No figure set.'
  FROM public.staff_ministries sm
  JOIN public.finance_projects fp
    ON lower(btrim(fp.name)) = lower(btrim(sm.name))
  JOIN public.finance_orgs o ON o.id = fp.org_id AND o.key = 'npc'
 WHERE NOT EXISTS (
   SELECT 1
     FROM public.staff_ministries other
    WHERE lower(btrim(other.name)) = lower(btrim(sm.name))
      AND other.id <> sm.id
 )
   AND NOT EXISTS (
     SELECT 1
       FROM public.department_budget_links existing
      WHERE existing.staff_ministry_id = sm.id
        AND existing.finance_project_id = fp.id
   );

COMMIT;
