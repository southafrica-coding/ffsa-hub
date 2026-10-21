-- ────────────────────────────────────────────────────────────
-- 260 — Outreach finance: anyone can start an outreach; owner + co-leaders
--
-- Until now only finance staff could create an outreach team, and every
-- team member could see (and log against) the whole budget. Now:
--
--   * Anyone signed in can create an outreach. They become its OWNER.
--   * The owner alone invites CO-LEADERS. Co-leaders (and the owner) run
--     the team's finances end to end: budget, planner, expenses, cash,
--     fund releases, closeout.
--   * Owner and co-leaders add plain TEAM MEMBERS: the people on the trip.
--     Members see the team (dates, place, who's going) but none of the
--     money.
--   * Finance staff (admin, finance_admin, finance.view / finance.edit)
--     keep seeing every team; editors can still step in anywhere,
--     including adding co-leaders and handing over ownership.
--   * A closeout whose variance breaks 2% still needs finance staff to
--     approve or reject it.
--
-- Old team roles collapse: outreach_leader, finance_student,
-- school_leader and finance_admin all become co_leader. Each team's
-- creator (created_by) becomes its owner.
--
-- Members no longer read outreach_teams directly (the row carries
-- total_budget_zar); they get the money-free view through
-- my_outreach_teams() and outreach_team_overview().
-- ────────────────────────────────────────────────────────────

-- A team no longer has to belong to a school.
ALTER TABLE public.outreach_teams ALTER COLUMN program_id DROP NOT NULL;

-- ── Roles ───────────────────────────────────────────────────
ALTER TABLE public.outreach_team_members
  DROP CONSTRAINT IF EXISTS outreach_team_members_role_check;

UPDATE public.outreach_team_members
SET role = 'co_leader'
WHERE role IN ('outreach_leader', 'finance_student', 'school_leader', 'finance_admin');

-- Creator becomes owner: promote them if already on the team, else add them.
UPDATE public.outreach_team_members m
SET role = 'owner'
FROM public.outreach_teams t
WHERE m.team_id = t.id AND m.user_id = t.created_by;

INSERT INTO public.outreach_team_members (team_id, user_id, role)
SELECT t.id, t.created_by, 'owner'
FROM public.outreach_teams t
WHERE NOT EXISTS (
  SELECT 1 FROM public.outreach_team_members m
  WHERE m.team_id = t.id AND m.user_id = t.created_by
);

ALTER TABLE public.outreach_team_members
  ADD CONSTRAINT outreach_team_members_role_check
  CHECK (role IN ('owner', 'co_leader', 'team_member'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_otm_one_owner
  ON public.outreach_team_members(team_id) WHERE role = 'owner';

-- ── Helpers ─────────────────────────────────────────────────
-- Finance staff who may read every team.
CREATE OR REPLACE FUNCTION public.is_outreach_staff_viewer()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
    OR public.has_role('finance_admin')
    OR public.has_permission('finance.view')
    OR public.has_permission('finance.edit');
$$;

-- Finance staff who may change any team.
CREATE OR REPLACE FUNCTION public.is_outreach_staff_editor()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
    OR public.has_role('finance_admin')
    OR public.has_permission('finance.edit');
$$;

CREATE OR REPLACE FUNCTION public.is_outreach_owner(check_team_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.outreach_team_members
    WHERE team_id = check_team_id AND user_id = auth.uid() AND role = 'owner'
  );
$$;

-- Owner or co-leader: runs the team's finances.
CREATE OR REPLACE FUNCTION public.is_outreach_leader(check_team_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.outreach_team_members
    WHERE team_id = check_team_id AND user_id = auth.uid()
      AND role IN ('owner', 'co_leader')
  );
$$;

-- Older names, kept because other code and policies call them.
CREATE OR REPLACE FUNCTION public.is_outreach_finance_admin(check_team_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_outreach_staff_editor() OR public.is_outreach_leader(check_team_id);
$$;

CREATE OR REPLACE FUNCTION public.can_edit_outreach_budget(check_team_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_outreach_staff_editor() OR public.is_outreach_leader(check_team_id);
$$;

CREATE OR REPLACE FUNCTION public.can_add_outreach_category()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_outreach_staff_editor()
    OR EXISTS (
      SELECT 1 FROM public.outreach_team_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'co_leader')
    );
$$;

-- ── The creator becomes owner ───────────────────────────────
CREATE OR REPLACE FUNCTION public.outreach_team_add_owner()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.outreach_team_members (team_id, user_id, role)
  VALUES (NEW.id, NEW.created_by, 'owner')
  ON CONFLICT (team_id, user_id) DO UPDATE SET role = 'owner';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_outreach_team_owner ON public.outreach_teams;
CREATE TRIGGER trg_outreach_team_owner
  AFTER INSERT ON public.outreach_teams
  FOR EACH ROW EXECUTE FUNCTION public.outreach_team_add_owner();

-- ── Handing over ownership ──────────────────────────────────
-- The owner (or finance staff) makes another person on the team the
-- owner; the old owner stays on as a co-leader.
CREATE OR REPLACE FUNCTION public.transfer_outreach_ownership(p_team uuid, p_member_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_outreach_owner(p_team) OR public.is_outreach_staff_editor()) THEN
    RAISE EXCEPTION 'Only the owner or finance staff can hand over this outreach' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.outreach_team_members WHERE id = p_member_id AND team_id = p_team
  ) THEN
    RAISE EXCEPTION 'That person is not on this team' USING ERRCODE = '22023';
  END IF;

  UPDATE public.outreach_team_members
  SET role = 'co_leader'
  WHERE team_id = p_team AND role = 'owner' AND id <> p_member_id;

  UPDATE public.outreach_team_members SET role = 'owner' WHERE id = p_member_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_outreach_ownership(uuid, uuid) TO authenticated;

-- ── The money-free member view ──────────────────────────────
CREATE OR REPLACE FUNCTION public.my_outreach_teams()
RETURNS TABLE (
  membership_id uuid,
  role          text,
  team_id       uuid,
  team_name     text,
  location      text,
  country       text,
  status        text,
  start_date    date,
  end_date      date,
  program_name  text,
  program_code  text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.role, t.id, t.team_name, t.location, t.country, t.status,
         t.start_date, t.end_date, p.name, p.code
  FROM public.outreach_team_members m
  JOIN public.outreach_teams t ON t.id = m.team_id
  LEFT JOIN public.programs p ON p.id = t.program_id
  WHERE m.user_id = auth.uid()
  ORDER BY m.joined_at DESC;
$$;

-- One team for anyone on it: where, when, who's going, and your role.
-- NULL when the caller is neither on the team nor finance staff.
CREATE OR REPLACE FUNCTION public.outreach_team_overview(p_team uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT (public.is_outreach_team_member(p_team) OR public.is_outreach_staff_viewer()) THEN NULL
    ELSE (
      SELECT jsonb_build_object(
        'id', t.id,
        'team_name', t.team_name,
        'location', t.location,
        'country', t.country,
        'status', t.status,
        'start_date', t.start_date,
        'end_date', t.end_date,
        'people_count', t.people_count,
        'program_name', p.name,
        'my_role', (
          SELECT m.role FROM public.outreach_team_members m
          WHERE m.team_id = t.id AND m.user_id = auth.uid()
        ),
        'roster', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
                   'id', m.id,
                   'role', m.role,
                   'name', coalesce(
                     nullif(trim(concat_ws(' ', coalesce(u.preferred_name, u.first_name), u.last_name)), ''),
                     u.email)
                 ) ORDER BY
                   CASE m.role WHEN 'owner' THEN 0 WHEN 'co_leader' THEN 1 ELSE 2 END,
                   u.first_name, u.last_name)
          FROM public.outreach_team_members m
          JOIN public.users u ON u.id = m.user_id
          WHERE m.team_id = t.id
        ), '[]'::jsonb)
      )
      FROM public.outreach_teams t
      LEFT JOIN public.programs p ON p.id = t.program_id
      WHERE t.id = p_team
    )
  END;
$$;

GRANT EXECUTE ON FUNCTION public.my_outreach_teams() TO authenticated;
GRANT EXECUTE ON FUNCTION public.outreach_team_overview(uuid) TO authenticated;

-- ── Policies ────────────────────────────────────────────────
-- Every policy on these tables is rebuilt from scratch below, so drop
-- them all whatever earlier migrations called them. (Categories are left
-- alone: everyone reads them, can_add_outreach_category() above decides
-- who adds one.)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN (
      'outreach_teams', 'outreach_team_members', 'outreach_team_budgets',
      'outreach_fund_releases', 'outreach_cash_batches', 'outreach_expenses',
      'outreach_receipts', 'outreach_closeouts', 'outreach_expense_imports',
      'outreach_budget_lines', 'outreach_budget_imports', 'outreach_day_plans',
      'outreach_receipt_drafts'
    )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END;
$$;

-- TEAMS — anyone may start one (as themselves); leaders + staff read and edit.
CREATE POLICY "Read outreach teams" ON public.outreach_teams FOR SELECT
  USING (public.is_outreach_staff_viewer() OR public.is_outreach_leader(id));
CREATE POLICY "Create outreach teams" ON public.outreach_teams FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND created_by = auth.uid());
CREATE POLICY "Update outreach teams" ON public.outreach_teams FOR UPDATE
  USING (public.is_outreach_staff_editor() OR public.is_outreach_leader(id))
  WITH CHECK (public.is_outreach_staff_editor() OR public.is_outreach_leader(id));

-- MEMBERS — everyone on the team sees the roster.
--   owner: adds/changes/removes co-leaders and members
--   co-leader: adds/removes plain members only
--   nobody edits the owner row directly (transfer_outreach_ownership does)
CREATE POLICY "Read team members" ON public.outreach_team_members FOR SELECT
  USING (public.is_outreach_staff_viewer() OR public.is_outreach_team_member(team_id));
CREATE POLICY "Add team members" ON public.outreach_team_members FOR INSERT
  WITH CHECK (
    role <> 'owner' AND (
      public.is_outreach_staff_editor()
      OR public.is_outreach_owner(team_id)
      OR (role = 'team_member' AND public.is_outreach_leader(team_id))
    )
  );
CREATE POLICY "Change team member roles" ON public.outreach_team_members FOR UPDATE
  USING (role <> 'owner' AND (public.is_outreach_staff_editor() OR public.is_outreach_owner(team_id)))
  WITH CHECK (role <> 'owner' AND (public.is_outreach_staff_editor() OR public.is_outreach_owner(team_id)));
CREATE POLICY "Remove team members" ON public.outreach_team_members FOR DELETE
  USING (
    role <> 'owner' AND (
      public.is_outreach_staff_editor()
      OR public.is_outreach_owner(team_id)
      OR (role = 'team_member' AND public.is_outreach_leader(team_id))
    )
  );

-- MONEY — staff viewers read, staff editors + the team's leaders write.
CREATE POLICY "Read team budgets" ON public.outreach_team_budgets FOR SELECT
  USING (public.is_outreach_staff_viewer() OR public.is_outreach_leader(team_id));
CREATE POLICY "Insert team budgets" ON public.outreach_team_budgets FOR INSERT
  WITH CHECK (public.can_edit_outreach_budget(team_id));
CREATE POLICY "Update team budgets" ON public.outreach_team_budgets FOR UPDATE
  USING (public.can_edit_outreach_budget(team_id))
  WITH CHECK (public.can_edit_outreach_budget(team_id));
CREATE POLICY "Delete team budgets" ON public.outreach_team_budgets FOR DELETE
  USING (public.is_outreach_staff_editor());

CREATE POLICY "Read fund releases" ON public.outreach_fund_releases FOR SELECT
  USING (public.is_outreach_staff_viewer() OR public.is_outreach_leader(team_id));
CREATE POLICY "Insert fund releases" ON public.outreach_fund_releases FOR INSERT
  WITH CHECK (public.can_edit_outreach_budget(team_id));
CREATE POLICY "Update fund releases" ON public.outreach_fund_releases FOR UPDATE
  USING (public.can_edit_outreach_budget(team_id))
  WITH CHECK (public.can_edit_outreach_budget(team_id));
CREATE POLICY "Delete fund releases" ON public.outreach_fund_releases FOR DELETE
  USING (public.can_edit_outreach_budget(team_id));

CREATE POLICY "Read cash batches" ON public.outreach_cash_batches FOR SELECT
  USING (public.is_outreach_staff_viewer() OR public.is_outreach_leader(team_id));
CREATE POLICY "Insert cash batches" ON public.outreach_cash_batches FOR INSERT
  WITH CHECK (public.can_edit_outreach_budget(team_id));
CREATE POLICY "Update cash batches" ON public.outreach_cash_batches FOR UPDATE
  USING (public.can_edit_outreach_budget(team_id))
  WITH CHECK (public.can_edit_outreach_budget(team_id));
CREATE POLICY "Delete cash batches" ON public.outreach_cash_batches FOR DELETE
  USING (public.can_edit_outreach_budget(team_id));

CREATE POLICY "Read expenses" ON public.outreach_expenses FOR SELECT
  USING (public.is_outreach_staff_viewer() OR public.is_outreach_leader(team_id));
CREATE POLICY "Insert expenses" ON public.outreach_expenses FOR INSERT
  WITH CHECK (public.can_edit_outreach_budget(team_id));
CREATE POLICY "Update expenses" ON public.outreach_expenses FOR UPDATE
  USING (public.can_edit_outreach_budget(team_id))
  WITH CHECK (public.can_edit_outreach_budget(team_id));
CREATE POLICY "Delete expenses" ON public.outreach_expenses FOR DELETE
  USING (public.can_edit_outreach_budget(team_id));

CREATE POLICY "Read receipts" ON public.outreach_receipts FOR SELECT
  USING (public.is_outreach_staff_viewer() OR EXISTS (
    SELECT 1 FROM public.outreach_expenses e
    WHERE e.id = expense_id AND public.is_outreach_leader(e.team_id)
  ));
CREATE POLICY "Insert receipts" ON public.outreach_receipts FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.outreach_expenses e
    WHERE e.id = expense_id AND public.can_edit_outreach_budget(e.team_id)
  ));
CREATE POLICY "Delete receipts" ON public.outreach_receipts FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.outreach_expenses e
    WHERE e.id = expense_id AND public.can_edit_outreach_budget(e.team_id)
  ));

-- Leaders submit a closeout; only staff approve or reject a >2% variance.
CREATE POLICY "Read closeouts" ON public.outreach_closeouts FOR SELECT
  USING (public.is_outreach_staff_viewer() OR public.is_outreach_leader(team_id));
CREATE POLICY "Submit closeouts" ON public.outreach_closeouts FOR INSERT
  WITH CHECK (
    public.is_outreach_staff_editor()
    OR (public.is_outreach_leader(team_id) AND status IN ('auto_closed', 'pending'))
  );
CREATE POLICY "Update closeouts" ON public.outreach_closeouts FOR UPDATE
  USING (public.is_outreach_staff_editor() OR public.is_outreach_leader(team_id))
  WITH CHECK (
    public.is_outreach_staff_editor()
    OR (public.is_outreach_leader(team_id) AND status IN ('auto_closed', 'pending'))
  );

CREATE POLICY "Read expense imports" ON public.outreach_expense_imports FOR SELECT
  USING (public.is_outreach_staff_viewer() OR public.is_outreach_leader(team_id));
CREATE POLICY "Write expense imports" ON public.outreach_expense_imports FOR INSERT
  WITH CHECK (public.can_edit_outreach_budget(team_id));
CREATE POLICY "Delete expense imports" ON public.outreach_expense_imports FOR DELETE
  USING (public.can_edit_outreach_budget(team_id));

CREATE POLICY "Read budget lines" ON public.outreach_budget_lines FOR SELECT
  USING (public.is_outreach_staff_viewer() OR public.is_outreach_leader(team_id));
CREATE POLICY "Insert budget lines" ON public.outreach_budget_lines FOR INSERT
  WITH CHECK (public.can_edit_outreach_budget(team_id));
CREATE POLICY "Update budget lines" ON public.outreach_budget_lines FOR UPDATE
  USING (public.can_edit_outreach_budget(team_id))
  WITH CHECK (public.can_edit_outreach_budget(team_id));
CREATE POLICY "Delete budget lines" ON public.outreach_budget_lines FOR DELETE
  USING (public.can_edit_outreach_budget(team_id));

CREATE POLICY "Read budget imports" ON public.outreach_budget_imports FOR SELECT
  USING (public.is_outreach_staff_viewer() OR public.is_outreach_leader(team_id));
CREATE POLICY "Write budget imports" ON public.outreach_budget_imports FOR INSERT
  WITH CHECK (public.can_edit_outreach_budget(team_id));

CREATE POLICY "Read day plans" ON public.outreach_day_plans FOR SELECT
  USING (public.is_outreach_staff_viewer() OR public.is_outreach_leader(team_id));
CREATE POLICY "Insert day plans" ON public.outreach_day_plans FOR INSERT
  WITH CHECK (public.can_edit_outreach_budget(team_id));
CREATE POLICY "Update day plans" ON public.outreach_day_plans FOR UPDATE
  USING (public.can_edit_outreach_budget(team_id))
  WITH CHECK (public.can_edit_outreach_budget(team_id));
CREATE POLICY "Delete day plans" ON public.outreach_day_plans FOR DELETE
  USING (public.can_edit_outreach_budget(team_id));

-- Slack receipt drafts are written by the bot (service role); read only.
CREATE POLICY "Read receipt drafts" ON public.outreach_receipt_drafts FOR SELECT
  USING (public.is_outreach_staff_viewer() OR public.is_outreach_leader(team_id));
