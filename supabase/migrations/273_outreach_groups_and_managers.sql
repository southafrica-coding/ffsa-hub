-- ============================================================
-- FFSA Hub — Migration 273: outreach groups and group managers
-- ============================================================
-- Safe to run twice: tables and indexes are IF NOT EXISTS, functions are
-- CREATE OR REPLACE, and every policy is dropped by name before it is
-- created again.
--
-- Outreach access gets three layers.
--
--   TEAMS (bottom) — unchanged. A team's roster decides who is on it; the
--     owner and co-leaders run its money, plain members see the trip but
--     none of the money (migration 260).
--
--   GROUPS (middle) — new. An outreach group bundles teams by category
--     ("Nations outreach", "Local missions" …). A team may sit in more than
--     one group. Outreach administrators create, rename and delete groups,
--     pick their teams and assign their managers.
--
--   MANAGERS (top) — new. A person is assigned to GROUPS, never to single
--     teams. A manager sees every team in the groups they manage and has a
--     co-leader's powers on it: budget, planner, expenses, cash, fund
--     releases, receipts, closeout, and adding / removing plain team
--     members. They may also add teams to and take teams out of the groups
--     they manage. Access is computed live from group membership: a team
--     added to a group is visible to that group's managers straight away,
--     and a team taken out of the group is gone from them straight away.
--     Nothing is copied onto the team.
--
--   GROUP PEERS — a team's owner and co-leaders can READ (never change)
--     every other team in any group their own team belongs to.
--
-- Who counts as an outreach administrator is NOT new: it is
-- public.is_outreach_staff_editor() from migration 260 — Super Admin,
-- General Admin, the finance_admin role, or a finance.edit grant. They, and
-- the finance.view readers in is_outreach_staff_viewer(), keep seeing every
-- team exactly as before.
--
-- NOBODY LOSES ACCESS. Every policy rebuilt below keeps each condition it
-- had before (staff viewer / staff editor / leader / owner / member) and
-- only ORs the new group conditions onto it. user_roles and
-- user_permissions are not touched.
--
-- What stays with outreach administrators only: archiving and deleting
-- teams (migration 272), approving or rejecting a closeout over 2%,
-- handing over ownership, adding co-leaders and changing roles, and
-- deleting category budgets.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. Tables
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.outreach_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (btrim(name) <> ''),
  -- The kind of outreach this group bundles, e.g. "Nations" or "Local".
  category    text,
  description text,
  created_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_groups_name
  ON public.outreach_groups (lower(btrim(name)));

-- Which teams are in which group. A team can be in many groups.
CREATE TABLE IF NOT EXISTS public.outreach_group_teams (
  group_id uuid NOT NULL REFERENCES public.outreach_groups(id) ON DELETE CASCADE,
  team_id  uuid NOT NULL REFERENCES public.outreach_teams(id) ON DELETE CASCADE,
  added_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_outreach_group_teams_team
  ON public.outreach_group_teams(team_id);

-- Who manages which group.
CREATE TABLE IF NOT EXISTS public.outreach_group_managers (
  group_id uuid NOT NULL REFERENCES public.outreach_groups(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  added_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_outreach_group_managers_user
  ON public.outreach_group_managers(user_id);

ALTER TABLE public.outreach_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_group_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_group_managers ENABLE ROW LEVEL SECURITY;


-- ────────────────────────────────────────────────────────────
-- 2. Helpers
-- ────────────────────────────────────────────────────────────
-- SECURITY DEFINER so policies on the group tables can call them without
-- recursing into their own RLS.

-- The caller manages this group.
CREATE OR REPLACE FUNCTION public.manages_outreach_group(p_group uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.outreach_group_managers
    WHERE group_id = p_group AND user_id = auth.uid()
  );
$$;

-- The caller manages at least one group.
CREATE OR REPLACE FUNCTION public.is_outreach_manager()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.outreach_group_managers WHERE user_id = auth.uid()
  );
$$;

-- The caller manages a group this team is in RIGHT NOW. Read live from the
-- two link tables, so taking the team out of the group ends the access.
CREATE OR REPLACE FUNCTION public.is_outreach_group_manager(check_team_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.outreach_group_teams gt
    JOIN public.outreach_group_managers gm ON gm.group_id = gt.group_id
    WHERE gt.team_id = check_team_id AND gm.user_id = auth.uid()
  );
$$;

-- The caller is the owner or a co-leader of some team in this group.
CREATE OR REPLACE FUNCTION public.leads_team_in_outreach_group(p_group uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.outreach_group_teams gt
    JOIN public.outreach_team_members m ON m.team_id = gt.team_id
    WHERE gt.group_id = p_group
      AND m.user_id = auth.uid()
      AND m.role IN ('owner', 'co_leader')
  );
$$;

-- The caller leads a team that shares a group with this one: read-only.
CREATE OR REPLACE FUNCTION public.is_outreach_group_peer_leader(check_team_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.outreach_group_teams mine
    JOIN public.outreach_group_teams theirs ON theirs.group_id = mine.group_id
    JOIN public.outreach_team_members m ON m.team_id = mine.team_id
    WHERE theirs.team_id = check_team_id
      AND m.user_id = auth.uid()
      AND m.role IN ('owner', 'co_leader')
  );
$$;

-- May READ the team and its money. A superset of the old read rule
-- (is_outreach_staff_viewer() OR is_outreach_leader()).
CREATE OR REPLACE FUNCTION public.can_view_outreach_team(check_team_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_outreach_staff_viewer()
    OR public.is_outreach_leader(check_team_id)
    OR public.is_outreach_group_manager(check_team_id)
    OR public.is_outreach_group_peer_leader(check_team_id);
$$;

-- May CHANGE the team and its money: staff editors, the team's own
-- leaders, and the managers of any group it is in. Group peers are not
-- here — they only read.
CREATE OR REPLACE FUNCTION public.can_edit_outreach_team(check_team_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_outreach_staff_editor()
    OR public.is_outreach_leader(check_team_id)
    OR public.is_outreach_group_manager(check_team_id);
$$;

-- The older write helpers every money policy and RPC already calls
-- (migrations 236, 252, 260, 263). Widening them is what gives managers
-- the same write powers as a leader everywhere at once.
CREATE OR REPLACE FUNCTION public.can_edit_outreach_budget(check_team_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_edit_outreach_team(check_team_id);
$$;

CREATE OR REPLACE FUNCTION public.is_outreach_finance_admin(check_team_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_edit_outreach_team(check_team_id);
$$;

-- Managers can add budget categories, like leaders can.
CREATE OR REPLACE FUNCTION public.can_add_outreach_category()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_outreach_staff_editor()
    OR public.is_outreach_manager()
    OR EXISTS (
      SELECT 1 FROM public.outreach_team_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'co_leader')
    );
$$;

-- May add teams to / take teams out of this group.
CREATE OR REPLACE FUNCTION public.can_manage_outreach_group(p_group uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_outreach_staff_editor() OR public.manages_outreach_group(p_group);
$$;

GRANT EXECUTE ON FUNCTION public.manages_outreach_group(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_outreach_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_outreach_group_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leads_team_in_outreach_group(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_outreach_group_peer_leader(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_outreach_team(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_outreach_team(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_outreach_group(uuid) TO authenticated;


-- ────────────────────────────────────────────────────────────
-- 3. The team picker for a group
-- ────────────────────────────────────────────────────────────
-- Every team's name, place and dates — no money — so an administrator or a
-- manager can pick teams for a group. Empty for anyone else.
CREATE OR REPLACE FUNCTION public.outreach_group_team_directory()
RETURNS TABLE (
  team_id      uuid,
  team_name    text,
  location     text,
  country      text,
  status       text,
  start_date   date,
  end_date     date,
  program_code text,
  archived     boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.team_name, t.location, t.country, t.status,
         t.start_date, t.end_date, p.code, t.archived_at IS NOT NULL
  FROM public.outreach_teams t
  LEFT JOIN public.programs p ON p.id = t.program_id
  WHERE public.is_outreach_staff_viewer() OR public.is_outreach_manager()
  ORDER BY t.team_name;
$$;

GRANT EXECUTE ON FUNCTION public.outreach_group_team_directory() TO authenticated;


-- ────────────────────────────────────────────────────────────
-- 4. Policies on the group tables
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Read outreach groups" ON public.outreach_groups;
DROP POLICY IF EXISTS "Create outreach groups" ON public.outreach_groups;
DROP POLICY IF EXISTS "Update outreach groups" ON public.outreach_groups;
DROP POLICY IF EXISTS "Delete outreach groups" ON public.outreach_groups;

-- Staff, the group's managers, and leaders of a team in it (so a leader
-- can see the group their team sits in).
CREATE POLICY "Read outreach groups" ON public.outreach_groups FOR SELECT
  USING (
    public.is_outreach_staff_viewer()
    OR public.manages_outreach_group(id)
    OR public.leads_team_in_outreach_group(id)
  );
CREATE POLICY "Create outreach groups" ON public.outreach_groups FOR INSERT
  WITH CHECK (public.is_outreach_staff_editor());
CREATE POLICY "Update outreach groups" ON public.outreach_groups FOR UPDATE
  USING (public.is_outreach_staff_editor())
  WITH CHECK (public.is_outreach_staff_editor());
CREATE POLICY "Delete outreach groups" ON public.outreach_groups FOR DELETE
  USING (public.is_outreach_staff_editor());

DROP POLICY IF EXISTS "Read group teams" ON public.outreach_group_teams;
DROP POLICY IF EXISTS "Add group teams" ON public.outreach_group_teams;
DROP POLICY IF EXISTS "Remove group teams" ON public.outreach_group_teams;

CREATE POLICY "Read group teams" ON public.outreach_group_teams FOR SELECT
  USING (
    public.is_outreach_staff_viewer()
    OR public.manages_outreach_group(group_id)
    OR public.leads_team_in_outreach_group(group_id)
  );
-- Administrators, and the group's own managers. No UPDATE policy: a link
-- is added or removed, never edited.
CREATE POLICY "Add group teams" ON public.outreach_group_teams FOR INSERT
  WITH CHECK (public.can_manage_outreach_group(group_id));
CREATE POLICY "Remove group teams" ON public.outreach_group_teams FOR DELETE
  USING (public.can_manage_outreach_group(group_id));

DROP POLICY IF EXISTS "Read group managers" ON public.outreach_group_managers;
DROP POLICY IF EXISTS "Add group managers" ON public.outreach_group_managers;
DROP POLICY IF EXISTS "Remove group managers" ON public.outreach_group_managers;

CREATE POLICY "Read group managers" ON public.outreach_group_managers FOR SELECT
  USING (
    public.is_outreach_staff_viewer()
    OR user_id = auth.uid()
    OR public.manages_outreach_group(group_id)
  );
-- Only administrators decide who manages what.
CREATE POLICY "Add group managers" ON public.outreach_group_managers FOR INSERT
  WITH CHECK (public.is_outreach_staff_editor());
CREATE POLICY "Remove group managers" ON public.outreach_group_managers FOR DELETE
  USING (public.is_outreach_staff_editor());


-- ────────────────────────────────────────────────────────────
-- 5. Outreach team policies, rebuilt with the group layer
-- ────────────────────────────────────────────────────────────
-- Each one is migration 260's policy (263's for cash allocations) with the
-- group conditions added. READ: is_outreach_staff_viewer() OR
-- is_outreach_leader() becomes can_view_outreach_team(), which still holds
-- both. WRITE: anything that said is_outreach_leader() now also accepts
-- is_outreach_group_manager(). Write policies that already go through
-- can_edit_outreach_budget() pick managers up from section 2 and are left
-- as they are.

-- TEAMS
DROP POLICY IF EXISTS "Read outreach teams" ON public.outreach_teams;
CREATE POLICY "Read outreach teams" ON public.outreach_teams FOR SELECT
  USING (public.can_view_outreach_team(id));

DROP POLICY IF EXISTS "Update outreach teams" ON public.outreach_teams;
CREATE POLICY "Update outreach teams" ON public.outreach_teams FOR UPDATE
  USING (public.can_edit_outreach_team(id))
  WITH CHECK (public.can_edit_outreach_team(id));

-- MEMBERS — managers act as a co-leader: they add and remove plain team
-- members. Adding co-leaders, changing roles and handing over ownership
-- stay with the owner and administrators.
DROP POLICY IF EXISTS "Read team members" ON public.outreach_team_members;
CREATE POLICY "Read team members" ON public.outreach_team_members FOR SELECT
  USING (
    public.is_outreach_staff_viewer()
    OR public.is_outreach_team_member(team_id)
    OR public.is_outreach_group_manager(team_id)
    OR public.is_outreach_group_peer_leader(team_id)
  );

DROP POLICY IF EXISTS "Add team members" ON public.outreach_team_members;
CREATE POLICY "Add team members" ON public.outreach_team_members FOR INSERT
  WITH CHECK (
    role <> 'owner' AND (
      public.is_outreach_staff_editor()
      OR public.is_outreach_owner(team_id)
      OR (role = 'team_member' AND (
        public.is_outreach_leader(team_id) OR public.is_outreach_group_manager(team_id)
      ))
    )
  );

DROP POLICY IF EXISTS "Remove team members" ON public.outreach_team_members;
CREATE POLICY "Remove team members" ON public.outreach_team_members FOR DELETE
  USING (
    role <> 'owner' AND (
      public.is_outreach_staff_editor()
      OR public.is_outreach_owner(team_id)
      OR (role = 'team_member' AND (
        public.is_outreach_leader(team_id) OR public.is_outreach_group_manager(team_id)
      ))
    )
  );
-- "Change team member roles" (owner + administrators) is unchanged.

-- MONEY — reads
DROP POLICY IF EXISTS "Read team budgets" ON public.outreach_team_budgets;
CREATE POLICY "Read team budgets" ON public.outreach_team_budgets FOR SELECT
  USING (public.can_view_outreach_team(team_id));

DROP POLICY IF EXISTS "Read fund releases" ON public.outreach_fund_releases;
CREATE POLICY "Read fund releases" ON public.outreach_fund_releases FOR SELECT
  USING (public.can_view_outreach_team(team_id));

DROP POLICY IF EXISTS "Read cash batches" ON public.outreach_cash_batches;
CREATE POLICY "Read cash batches" ON public.outreach_cash_batches FOR SELECT
  USING (public.can_view_outreach_team(team_id));

DROP POLICY IF EXISTS "Read expenses" ON public.outreach_expenses;
CREATE POLICY "Read expenses" ON public.outreach_expenses FOR SELECT
  USING (public.can_view_outreach_team(team_id));

DROP POLICY IF EXISTS "Read receipts" ON public.outreach_receipts;
CREATE POLICY "Read receipts" ON public.outreach_receipts FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.outreach_expenses e
    WHERE e.id = expense_id AND public.can_view_outreach_team(e.team_id)
  ));

DROP POLICY IF EXISTS "Read expense imports" ON public.outreach_expense_imports;
CREATE POLICY "Read expense imports" ON public.outreach_expense_imports FOR SELECT
  USING (public.can_view_outreach_team(team_id));

DROP POLICY IF EXISTS "Read budget lines" ON public.outreach_budget_lines;
CREATE POLICY "Read budget lines" ON public.outreach_budget_lines FOR SELECT
  USING (public.can_view_outreach_team(team_id));

DROP POLICY IF EXISTS "Read budget imports" ON public.outreach_budget_imports;
CREATE POLICY "Read budget imports" ON public.outreach_budget_imports FOR SELECT
  USING (public.can_view_outreach_team(team_id));

DROP POLICY IF EXISTS "Read day plans" ON public.outreach_day_plans;
CREATE POLICY "Read day plans" ON public.outreach_day_plans FOR SELECT
  USING (public.can_view_outreach_team(team_id));

DROP POLICY IF EXISTS "Read receipt drafts" ON public.outreach_receipt_drafts;
CREATE POLICY "Read receipt drafts" ON public.outreach_receipt_drafts FOR SELECT
  USING (public.can_view_outreach_team(team_id));

DROP POLICY IF EXISTS "Read cash allocations" ON public.outreach_cash_allocations;
CREATE POLICY "Read cash allocations" ON public.outreach_cash_allocations FOR SELECT
  USING (public.can_view_outreach_team(team_id));

-- CLOSEOUTS — managers submit like leaders; only administrators approve
-- or reject a variance over 2%.
DROP POLICY IF EXISTS "Read closeouts" ON public.outreach_closeouts;
CREATE POLICY "Read closeouts" ON public.outreach_closeouts FOR SELECT
  USING (public.can_view_outreach_team(team_id));

DROP POLICY IF EXISTS "Submit closeouts" ON public.outreach_closeouts;
CREATE POLICY "Submit closeouts" ON public.outreach_closeouts FOR INSERT
  WITH CHECK (
    public.is_outreach_staff_editor()
    OR (
      (public.is_outreach_leader(team_id) OR public.is_outreach_group_manager(team_id))
      AND status IN ('auto_closed', 'pending')
    )
  );

DROP POLICY IF EXISTS "Update closeouts" ON public.outreach_closeouts;
CREATE POLICY "Update closeouts" ON public.outreach_closeouts FOR UPDATE
  USING (
    public.is_outreach_staff_editor()
    OR public.is_outreach_leader(team_id)
    OR public.is_outreach_group_manager(team_id)
  )
  WITH CHECK (
    public.is_outreach_staff_editor()
    OR (
      (public.is_outreach_leader(team_id) OR public.is_outreach_group_manager(team_id))
      AND status IN ('auto_closed', 'pending')
    )
  );


-- ============================================================
-- Verify:
--   SELECT tablename, policyname FROM pg_policies
--   WHERE schemaname = 'public' AND tablename LIKE 'outreach_group%'
--   ORDER BY 1, 2;
--
--   -- As a manager (SQL editor: set the JWT claim first):
--   --   SELECT set_config('request.jwt.claims', '{"sub":"<user id>"}', true);
--   SELECT public.is_outreach_group_manager('<team id>');
--   SELECT public.can_view_outreach_team('<team id>'),
--          public.can_edit_outreach_team('<team id>');
-- ============================================================
