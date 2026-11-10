-- ============================================================
-- FFSA Hub — Migration 320: Department budgets and finance-project links
-- ============================================================
-- Depends on 290 (finance_projects) and 317.
--
-- One budget envelope per staff ministry per calendar year. amount_cents
-- is an integer number of cents (ZAR by default, USD allowed), the same
-- unit as donations.amount_cents. Outreach budgets stay numeric rands;
-- this table does not touch them. finance_project_id is optional and is
-- not seeded — seeding a budget would invent an amount. There is no
-- line table: a year is one figure plus a note, which is the smallest
-- shape that is still a budget.
--
-- Read: an active admin, an unscoped finance.view or finance.edit grant,
-- the unscoped finance_admin role, an active Finances & Legal member,
-- or the leader of THAT ministry. A program-scoped finance grant does
-- not count, matching 316, and the check is local so it holds even when
-- 316 is not applied. Write: the ministry's leader, or an admin.
-- Finances & Legal can read every department budget and cannot edit one.
-- Everyone else, including a plain member of the ministry and any
-- inactive account, gets nothing.
--
-- staff_ministry_finance_projects records an exact name match between a
-- staff ministry and a finance project. "Exact" is lower(btrim(name))
-- on both sides, and the ministry name must be unique. HULC matches
-- the project named HULC and does not match HULC Merch. The same name
-- in FFSA NPC and FF USA Inc is two exact matches (one per org), not a
-- guess between two different names. Prayer & Worship does not match
-- Worship & Prayer. No project row is updated.
--
-- Matches this rule produces from the names in migrations 126, 250 and
-- 290 (a prod rename falls out of the match rather than being guessed):
--   HULC, Media, Project 54, Woven — NPC and USA, where both exist.
--   Woven is inactive and still matches, because the names are the same.
--   Hope Again matches only if a staff ministry (not the okr_teams row)
--   is named exactly Hope Again. Migrations do not insert that staff row.
-- Not matched, on purpose:
--   HULC Merch; Worship & Prayer (ministry is Prayer & Worship);
--   Missio - JHB, Missio - Potch, Missio to Base (10%), Mission to Base (10%);
--   1040 Crossfit (ministry is 1040); EFL / EFLTanz / EFL 2026 /
--   Educating for Life (ministry is Education or Ed for Life);
--   Rooted, Redwood Christian Academy, Redwoods Christian Academy;
--   Operations, Training, Events, Leadership Team, Finances & Legal,
--   Donors & Dev, Be Free, No Ministry, Inside Ministry, Outside Ministry;
--   buildings, camps, events and the General * rows.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.department_budgets (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_ministry_id  uuid NOT NULL REFERENCES public.staff_ministries (id) ON DELETE CASCADE,
  year               integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  finance_project_id uuid REFERENCES public.finance_projects (id) ON DELETE SET NULL,
  amount_cents       bigint NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  currency           text NOT NULL DEFAULT 'ZAR' CHECK (currency IN ('ZAR', 'USD')),
  notes              text,
  created_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
  updated_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_ministry_id, year)
);

CREATE INDEX IF NOT EXISTS department_budgets_finance_project_id_idx
  ON public.department_budgets (finance_project_id);
CREATE INDEX IF NOT EXISTS department_budgets_created_by_idx
  ON public.department_budgets (created_by);
CREATE INDEX IF NOT EXISTS department_budgets_updated_by_idx
  ON public.department_budgets (updated_by);

COMMENT ON TABLE public.department_budgets IS
  'One budget figure per staff ministry per year, in cents. Optional link to a finance project. Not an outreach budget.';
COMMENT ON COLUMN public.department_budgets.amount_cents IS
  'Integer cents. currency says whether they are ZAR or USD cents.';

DROP TRIGGER IF EXISTS set_updated_at ON public.department_budgets;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.department_budgets
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

ALTER TABLE public.department_budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.department_budgets FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.department_budgets TO authenticated, service_role;

DROP POLICY IF EXISTS "Finance and leaders read department budgets" ON public.department_budgets;
CREATE POLICY "Finance and leaders read department budgets"
  ON public.department_budgets FOR SELECT TO authenticated
  USING (public.dept_can_read_budget(staff_ministry_id));

DROP POLICY IF EXISTS "Leaders insert department budgets" ON public.department_budgets;
CREATE POLICY "Leaders insert department budgets"
  ON public.department_budgets FOR INSERT TO authenticated
  WITH CHECK (public.dept_can_write_budget(staff_ministry_id));

DROP POLICY IF EXISTS "Leaders update department budgets" ON public.department_budgets;
CREATE POLICY "Leaders update department budgets"
  ON public.department_budgets FOR UPDATE TO authenticated
  USING (public.dept_can_write_budget(staff_ministry_id))
  WITH CHECK (public.dept_can_write_budget(staff_ministry_id));

DROP POLICY IF EXISTS "Leaders delete department budgets" ON public.department_budgets;
CREATE POLICY "Leaders delete department budgets"
  ON public.department_budgets FOR DELETE TO authenticated
  USING (public.dept_can_write_budget(staff_ministry_id));

-- ────────────────────────────────────────────────────────────
-- Exact project links. Insert-only; a second paste does not unlink.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.staff_ministry_finance_projects (
  staff_ministry_id   uuid NOT NULL REFERENCES public.staff_ministries (id) ON DELETE CASCADE,
  finance_project_id  uuid NOT NULL REFERENCES public.finance_projects (id) ON DELETE CASCADE,
  match_basis         text NOT NULL DEFAULT 'exact_name' CHECK (match_basis IN ('exact_name')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_ministry_id, finance_project_id)
);

CREATE INDEX IF NOT EXISTS staff_ministry_finance_projects_project_idx
  ON public.staff_ministry_finance_projects (finance_project_id);

COMMENT ON TABLE public.staff_ministry_finance_projects IS
  'Exact ministry-name to finance-project-name links, one row per project (so NPC and USA are both kept). Not a budget amount.';

ALTER TABLE public.staff_ministry_finance_projects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_ministry_finance_projects FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_ministry_finance_projects TO authenticated, service_role;

DROP POLICY IF EXISTS "Finance and leaders read project links" ON public.staff_ministry_finance_projects;
CREATE POLICY "Finance and leaders read project links"
  ON public.staff_ministry_finance_projects FOR SELECT TO authenticated
  USING (public.dept_can_read_budget(staff_ministry_id));

DROP POLICY IF EXISTS "Org managers insert project links" ON public.staff_ministry_finance_projects;
CREATE POLICY "Org managers insert project links"
  ON public.staff_ministry_finance_projects FOR INSERT TO authenticated
  WITH CHECK (public.dept_can_write_org_structure());

DROP POLICY IF EXISTS "Org managers update project links" ON public.staff_ministry_finance_projects;
CREATE POLICY "Org managers update project links"
  ON public.staff_ministry_finance_projects FOR UPDATE TO authenticated
  USING (public.dept_can_write_org_structure())
  WITH CHECK (public.dept_can_write_org_structure());

DROP POLICY IF EXISTS "Org managers delete project links" ON public.staff_ministry_finance_projects;
CREATE POLICY "Org managers delete project links"
  ON public.staff_ministry_finance_projects FOR DELETE TO authenticated
  USING (public.dept_can_write_org_structure());

INSERT INTO public.staff_ministry_finance_projects (staff_ministry_id, finance_project_id, match_basis)
SELECT sm.id, fp.id, 'exact_name'
  FROM public.staff_ministries sm
  JOIN public.finance_projects fp
    ON lower(btrim(fp.name)) = lower(btrim(sm.name))
 WHERE NOT EXISTS (
   SELECT 1
     FROM public.staff_ministries other
    WHERE lower(btrim(other.name)) = lower(btrim(sm.name))
      AND other.id <> sm.id
 )
ON CONFLICT (staff_ministry_id, finance_project_id) DO NOTHING;
