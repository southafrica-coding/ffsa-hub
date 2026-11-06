-- ─────────────────────────────────────────────────────────────────────────────
-- 300 — budget_repayments
--
-- DRAFT ONLY. DO NOT APPLY.
--
-- Do not apply this file at all until PR #475 (feat/finance-budgets-foundation)
-- has been applied, migrations 295 through 299, in that order:
--   295_finance_audit_permissions_periods.sql
--   296_budgets_core.sql
--   297_budget_expense_tracker.sql
--   298_budget_views.sql
--   299_budget_privilege_hardening.sql
--
-- Do not apply this draft itself until Hub Data and Jack say so. Applying
-- this file does not apply 295–299 and does not stand in for them.
--
-- This is not the sheet Expense Tracker. public.budget_expenses is created
-- by 297 and stays that tracker (signed cents, no currency column, no Xero
-- ids). This file does not create, replace, or copy budget_expenses.
--
-- A repayment is money the purchaser owes because there was no receipt.
-- It is not an outreach_expenses row and it is not sent to Xero.
-- Organisation and currency are the parent budget's (budgets.org_id,
-- budgets.currency). There is no currency column and no second org column.
--
-- Once-only. Not safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

DO $guard$
BEGIN
  IF to_regclass('public.budgets') IS NULL
     OR to_regclass('public.budget_lines') IS NULL THEN
    RAISE EXCEPTION
      'DO NOT APPLY 300_budget_repayments.sql until PR #475 migrations 295-299 are applied (public.budgets / public.budget_lines are missing). Do not apply this draft on its own.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.budget_lines'::regclass
      AND contype = 'u'
      AND conname = 'budget_lines_id_budget_unique'
  ) THEN
    RAISE EXCEPTION
      'DO NOT APPLY 300_budget_repayments.sql until 297_budget_expense_tracker.sql has added budget_lines_id_budget_unique. This file does not create the sheet tracker.';
  END IF;
END
$guard$;


CREATE TABLE public.budget_repayments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id       uuid NOT NULL REFERENCES public.budgets(id) ON DELETE RESTRICT,
  -- NULL line: the composite FK is not checked (MATCH SIMPLE). A non-NULL
  -- line_id must be that budget's own line.
  line_id         uuid,
  hub_user_id     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  slack_user_id   text,
  team_id         uuid REFERENCES public.outreach_teams(id) ON DELETE RESTRICT,
  -- Always a positive amount the person owes, in the parent budget's
  -- currency. bigint, not a signed spend. See the column comment.
  amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
  description     text NOT NULL CHECK (btrim(description) <> '' AND char_length(description) <= 500),
  reason          text NOT NULL DEFAULT 'no_receipt' CHECK (reason IN ('no_receipt')),
  confirmed_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT budget_repayments_has_person CHECK (hub_user_id IS NOT NULL OR slack_user_id IS NOT NULL),
  CONSTRAINT budget_repayments_slack_user_check CHECK (
    slack_user_id IS NULL OR (btrim(slack_user_id) <> '' AND char_length(slack_user_id) <= 64)
  ),
  CONSTRAINT budget_repayments_line_budget_fkey
    FOREIGN KEY (line_id, budget_id)
    REFERENCES public.budget_lines (id, budget_id)
    ON DELETE RESTRICT
);

COMMENT ON TABLE public.budget_repayments IS
  'No-receipt repayments. The purchaser owes this amount; it is not a budget_expenses tracker row, not an outreach_expenses import, and not a Xero spend. Amounts are positive cents of the parent budget currency (budgets.currency via budget_id). No currency column and no org column. DO NOT APPLY until PR #475 (295-299) is applied.';

COMMENT ON COLUMN public.budget_repayments.amount_cents IS
  'Positive cents the person owes, in the parent budget''s currency (budgets.currency). bigint so it matches other budget money columns. Repayments are not a signed ledger: zero and negative amounts are rejected. PR #507 stored a separate currency; this table does not. A writer must only insert a row when the confirmed currency is that budget''s currency.';

COMMENT ON COLUMN public.budget_repayments.budget_id IS
  'Required. Organisation and currency come from this budget only.';

COMMENT ON COLUMN public.budget_repayments.line_id IS
  'Optional. When set, (line_id, budget_id) must reference budget_lines(id, budget_id), the same guard as budget_expenses. PR #507 sketched this as budget_line_id; the column is line_id so the composite key matches 297.';

COMMENT ON COLUMN public.budget_repayments.team_id IS
  'Optional Slack/outreach team. When set it must be this budget''s outreach_team_id. It is not a finance organisation.';

COMMENT ON COLUMN public.budget_repayments.reason IS
  'Why the row exists. The only value PR #507 writes is no_receipt.';

-- PR #507 has no idempotency token for repayments (the Xero Idempotency-Key
-- belongs to a receipt draft, and a repayment never reaches Xero). A repeat
-- of the same confirmation is the same budget, line, person, Slack user,
-- team, amount, reason, and description. NULL line_id, hub_user_id,
-- slack_user_id, and team_id count as equal (NULLS NOT DISTINCT) so a
-- double-tap still collides when those are absent. Description is compared
-- case-insensitively. Two genuine purchases that match on every column are
-- also rejected until a real confirmation id exists. Postgres 15+.
CREATE UNIQUE INDEX budget_repayments_one_confirm
  ON public.budget_repayments (
    budget_id,
    line_id,
    hub_user_id,
    slack_user_id,
    team_id,
    amount_cents,
    reason,
    lower(description)
  ) NULLS NOT DISTINCT;

COMMENT ON INDEX public.budget_repayments_one_confirm IS
  'Blocks a repeat confirm of the same repayment. PR #507 sends no separate idempotency key. NULLS NOT DISTINCT so a missing line or user still counts.';

CREATE INDEX budget_repayments_line_idx
  ON public.budget_repayments (line_id, budget_id)
  WHERE line_id IS NOT NULL;


CREATE FUNCTION finance_private.budget_repayments_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_team uuid;
BEGIN
  NEW.reason := btrim(NEW.reason);
  NEW.description := btrim(NEW.description);
  IF NEW.slack_user_id IS NOT NULL THEN
    NEW.slack_user_id := NULLIF(btrim(NEW.slack_user_id), '');
  END IF;

  IF TG_OP = 'UPDATE'
     AND ROW(NEW.budget_id, NEW.created_at, NEW.confirmed_at, NEW.hub_user_id, NEW.slack_user_id, NEW.team_id)
         IS DISTINCT FROM
         ROW(OLD.budget_id, OLD.created_at, OLD.confirmed_at, OLD.hub_user_id, OLD.slack_user_id, OLD.team_id) THEN
    RAISE EXCEPTION 'Repayment budget, person, team, confirmed_at and created_at are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.hub_user_id IS NULL AND NEW.slack_user_id IS NULL THEN
    RAISE EXCEPTION 'A repayment needs a Hub user or a Slack user'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.budgets b WHERE b.id = NEW.budget_id) THEN
    RAISE EXCEPTION 'Repayment budget does not exist' USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1 FROM public.budgets b
    WHERE b.id = NEW.budget_id AND b.archived_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot record a repayment on an archived budget'
      USING ERRCODE = '23514';
  END IF;

  SELECT b.outreach_team_id INTO v_team
  FROM public.budgets b
  WHERE b.id = NEW.budget_id;

  IF NEW.team_id IS NOT NULL AND NEW.team_id IS DISTINCT FROM v_team THEN
    RAISE EXCEPTION 'Repayment team must be this budget''s outreach team'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.line_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.budget_lines l
      WHERE l.id = NEW.line_id
        AND l.budget_id = NEW.budget_id
        AND l.archived_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Repayment line must be a live line of this budget'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.line_id IS NOT NULL AND NEW.line_id IS DISTINCT FROM OLD.line_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.budget_lines l
      WHERE l.id = NEW.line_id
        AND l.budget_id = NEW.budget_id
        AND l.archived_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Repayment line must be a live line of this budget'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.confirmed_at := coalesce(NEW.confirmed_at, now());
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION finance_private.budget_repayments_before_write() IS
  'Keeps a repayment on its budget: immutable budget and person, team must be that budget''s outreach team, line must be a live line of that budget. Not a permission helper.';

REVOKE ALL ON FUNCTION finance_private.budget_repayments_before_write()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER budget_repayments_before_write
  BEFORE INSERT OR UPDATE ON public.budget_repayments
  FOR EACH ROW EXECUTE FUNCTION finance_private.budget_repayments_before_write();

CREATE TRIGGER budget_repayments_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_repayments
  FOR EACH ROW EXECUTE FUNCTION finance_private.finance_audit_row();


ALTER TABLE public.budget_repayments ENABLE ROW LEVEL SECURITY;

-- Same access as the budget_expenses sheet tracker (297 / 299).
-- Read: anyone who can see the budget. Write: finance edit-all, or an
-- editor member, via finance_private.can_record_budget_expenses.
-- No new permission key. No DELETE.
REVOKE ALL ON TABLE public.budget_repayments FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.budget_repayments TO authenticated, service_role;

CREATE POLICY budget_repayments_read
  ON public.budget_repayments
  FOR SELECT
  TO authenticated
  USING (
    finance_private.can_view_all_budgets()
    OR finance_private.is_budget_member(budget_id)
  );

CREATE POLICY budget_repayments_insert
  ON public.budget_repayments
  FOR INSERT
  TO authenticated
  WITH CHECK (finance_private.can_record_budget_expenses(budget_id));

CREATE POLICY budget_repayments_update
  ON public.budget_repayments
  FOR UPDATE
  TO authenticated
  USING (finance_private.can_record_budget_expenses(budget_id))
  WITH CHECK (finance_private.can_record_budget_expenses(budget_id));
