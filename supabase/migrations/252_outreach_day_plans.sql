-- ────────────────────────────────────────────────────────────
-- 252 — Outreach day plans (the team lead's food / accommodation planner)
--
-- Team leads plan how much of a budget category (mostly Food and
-- Accommodation) they'll spend each day, against the money available in
-- that category, and compare with what was actually spent that day.
-- One row per team, category and day; a day with nothing planned has no
-- row. Replaces the automatic schedule built from budget lines (the
-- plan_kind / plan_start / plan_end columns from 249 are now unused).
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.outreach_day_plans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      uuid NOT NULL REFERENCES public.outreach_teams(id) ON DELETE CASCADE,
  category_id  uuid NOT NULL REFERENCES public.outreach_budget_categories(id) ON DELETE CASCADE,
  plan_date    date NOT NULL,
  amount_zar   numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount_zar >= 0),
  note         text,
  updated_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, category_id, plan_date)
);

CREATE INDEX IF NOT EXISTS idx_odp_team ON public.outreach_day_plans(team_id, plan_date);

ALTER TABLE public.outreach_day_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read day plans" ON public.outreach_day_plans;
CREATE POLICY "Read day plans"
  ON public.outreach_day_plans FOR SELECT
  USING (
    public.is_admin()
    OR public.has_role('finance_admin')
    OR public.has_permission('finance.view')
    OR public.has_permission('finance.edit')
    OR public.is_outreach_team_member(team_id)
  );

-- Same people who can edit the team's budget (migration 236).
DROP POLICY IF EXISTS "Insert day plans" ON public.outreach_day_plans;
CREATE POLICY "Insert day plans"
  ON public.outreach_day_plans FOR INSERT
  WITH CHECK (public.can_edit_outreach_budget(team_id));

DROP POLICY IF EXISTS "Update day plans" ON public.outreach_day_plans;
CREATE POLICY "Update day plans"
  ON public.outreach_day_plans FOR UPDATE
  USING (public.can_edit_outreach_budget(team_id))
  WITH CHECK (public.can_edit_outreach_budget(team_id));

DROP POLICY IF EXISTS "Delete day plans" ON public.outreach_day_plans;
CREATE POLICY "Delete day plans"
  ON public.outreach_day_plans FOR DELETE
  USING (public.can_edit_outreach_budget(team_id));
