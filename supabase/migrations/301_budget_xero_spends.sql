-- ─────────────────────────────────────────────────────────────────────────────
-- 301 — budget_xero_spends
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
-- 300_budget_repayments.sql is a separate table and is not required here.
--
-- This is the Xero / receipt log. It is not public.budget_expenses.
-- budget_expenses is the sheet Expense Tracker from 297 (manual rows,
-- expense_date, vendor, no receipt id, no Xero id). Do not insert receipt
-- or Xero rows there, and do not rename that tracker.
--
-- This is also not a second outreach ledger. outreach_expenses stays its
-- own system. outreach_expense_id is an optional pointer, not an import.
--
-- Organisation and currency are the parent budget's (budgets.org_id,
-- budgets.currency). There is no currency column, no org_key, and no
-- other org column. PR #475 already ties budgets.currency to
-- finance_orgs.record_currency.
--
-- Once-only. Not safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

DO $guard$
BEGIN
  IF to_regclass('public.budgets') IS NULL
     OR to_regclass('public.budget_lines') IS NULL
     OR to_regclass('public.outreach_receipt_drafts') IS NULL
     OR to_regclass('public.outreach_expenses') IS NULL THEN
    RAISE EXCEPTION
      'DO NOT APPLY 301_budget_xero_spends.sql until PR #475 migrations 295-299 are applied and outreach_receipt_drafts / outreach_expenses exist. Do not apply this draft on its own.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.budget_lines'::regclass
      AND contype = 'u'
      AND conname = 'budget_lines_id_budget_unique'
  ) THEN
    RAISE EXCEPTION
      'DO NOT APPLY 301_budget_xero_spends.sql until 297_budget_expense_tracker.sql has added budget_lines_id_budget_unique. This file does not create the sheet tracker.';
  END IF;
END
$guard$;


CREATE TABLE public.budget_xero_spends (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id                 uuid NOT NULL REFERENCES public.budgets(id) ON DELETE RESTRICT,
  -- NULL line: the composite FK is not checked (MATCH SIMPLE). A non-NULL
  -- line_id must be that budget's own line.
  line_id                   uuid,
  outreach_expense_id       uuid REFERENCES public.outreach_expenses(id) ON DELETE SET NULL,
  receipt_draft_id          uuid REFERENCES public.outreach_receipt_drafts(id) ON DELETE RESTRICT,
  purchaser_user_id         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  -- Signed cents of the parent budget's currency. See the column comment.
  amount_cents              bigint NOT NULL CHECK (amount_cents <> 0),
  spent_on                  date NOT NULL,
  description               text NOT NULL CHECK (btrim(description) <> '' AND char_length(description) <= 4000),
  has_receipt               boolean NOT NULL,
  xero_bank_transaction_id  text,
  xero_status               text NOT NULL CHECK (char_length(btrim(xero_status)) BETWEEN 1 AND 64),
  confirmed_at              timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT budget_xero_spends_bank_txn_check CHECK (
    xero_bank_transaction_id IS NULL
    OR (btrim(xero_bank_transaction_id) <> '' AND char_length(xero_bank_transaction_id) <= 64)
  ),
  CONSTRAINT budget_xero_spends_line_budget_fkey
    FOREIGN KEY (line_id, budget_id)
    REFERENCES public.budget_lines (id, budget_id)
    ON DELETE RESTRICT,
  -- One log row per receipt draft. Postgres UNIQUE is NULLS DISTINCT:
  -- many rows may have a NULL receipt_draft_id (a spend that is not tied
  -- to a draft), and a non-NULL draft id can appear only once. That is
  -- the idempotency PR #507 needs (a second confirm updates the row found
  -- by receipt_draft_id). NULLS NOT DISTINCT is not used, because it would
  -- allow only a single row with no draft.
  CONSTRAINT budget_xero_spends_receipt_draft_key UNIQUE (receipt_draft_id),
  CONSTRAINT budget_xero_spends_bank_txn_key UNIQUE (xero_bank_transaction_id),
  -- Optional link. At most one log row names a given outreach expense.
  -- Nothing in this migration copies outreach_expenses in.
  CONSTRAINT budget_xero_spends_outreach_expense_key UNIQUE (outreach_expense_id)
);

COMMENT ON TABLE public.budget_xero_spends IS
  'Receipt / Xero log for a budget. Not budget_expenses (that name is the sheet Expense Tracker from PR #475 migration 297) and not an outreach_expenses import. amount_cents is signed cents of the parent budget currency. No currency column and no org column. DO NOT APPLY until PR #475 (295-299) is applied.';

COMMENT ON COLUMN public.budget_xero_spends.amount_cents IS
  'Signed cents in the parent budget''s currency (budgets.currency via budget_id). Positive is a spend; negative is a reversal or refund; zero is rejected. Not a ZAR-only column and not a second currency.';

COMMENT ON COLUMN public.budget_xero_spends.budget_id IS
  'Required. Organisation (budgets.org_id) and currency (budgets.currency) come from this budget only. PR #507 sketched a nullable budget_id plus org_key and currency; those extra columns are omitted so they cannot drift from the budget.';

COMMENT ON COLUMN public.budget_xero_spends.line_id IS
  'Optional. When set, (line_id, budget_id) must reference budget_lines(id, budget_id), the same guard as budget_expenses. PR #507 sketched this as budget_line_id; the column is line_id so the composite key matches 297.';

COMMENT ON COLUMN public.budget_xero_spends.receipt_draft_id IS
  'Optional pointer to outreach_receipt_drafts. Unique among non-NULL values (Postgres UNIQUE NULLS DISTINCT). A second confirm for the same draft must update this row, not insert another. Several rows with no draft are allowed.';

COMMENT ON COLUMN public.budget_xero_spends.outreach_expense_id IS
  'Optional pointer to an existing outreach_expenses row. Unique when set. Deleting that expense clears the pointer and leaves this log row. This table does not import or mirror the outreach ledger.';

COMMENT ON COLUMN public.budget_xero_spends.xero_bank_transaction_id IS
  'Xero bank transaction id once a spend is posted. Unique among non-NULL values so one Xero spend is not logged twice. Empty is stored as NULL.';

COMMENT ON COLUMN public.budget_xero_spends.xero_status IS
  'Short status from the confirm path. Known values today: written, failed, rand_not_confirmed, no_account, no_bank_account, bad_amount. Not a free-standing workflow table.';

COMMENT ON COLUMN public.budget_xero_spends.has_receipt IS
  'True when the confirmed draft had a receipt file. PR #507 only writes this log for a confirmed receipt that is not a repayment.';

CREATE INDEX budget_xero_spends_budget_date_idx
  ON public.budget_xero_spends (budget_id, spent_on, id);

CREATE INDEX budget_xero_spends_line_idx
  ON public.budget_xero_spends (line_id, budget_id)
  WHERE line_id IS NOT NULL;


CREATE FUNCTION finance_private.budget_xero_spends_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND ROW(NEW.budget_id, NEW.created_at, NEW.receipt_draft_id)
         IS DISTINCT FROM
         ROW(OLD.budget_id, OLD.created_at, OLD.receipt_draft_id) THEN
    RAISE EXCEPTION 'Xero spend budget, receipt draft and created_at are immutable'
      USING ERRCODE = '23514';
  END IF;

  NEW.description := btrim(NEW.description);
  NEW.xero_status := btrim(NEW.xero_status);
  IF NEW.xero_bank_transaction_id IS NOT NULL THEN
    NEW.xero_bank_transaction_id := NULLIF(btrim(NEW.xero_bank_transaction_id), '');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.budgets b
    JOIN public.fiscal_periods fp ON fp.id = b.period_id
    WHERE b.id = NEW.budget_id
      AND NEW.spent_on BETWEEN fp.start_date AND fp.end_date
  ) THEN
    RAISE EXCEPTION 'Spend date must fall within the budget period'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1 FROM public.budgets b
    WHERE b.id = NEW.budget_id AND b.archived_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot log a Xero spend on an archived budget'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.line_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.budget_lines l
      WHERE l.id = NEW.line_id
        AND l.budget_id = NEW.budget_id
        AND l.archived_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Xero spend line must be a live line of this budget'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.line_id IS NOT NULL AND NEW.line_id IS DISTINCT FROM OLD.line_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.budget_lines l
      WHERE l.id = NEW.line_id
        AND l.budget_id = NEW.budget_id
        AND l.archived_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Xero spend line must be a live line of this budget'
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

COMMENT ON FUNCTION finance_private.budget_xero_spends_before_write() IS
  'Keeps a Xero/receipt log row on its budget: draft id and budget are immutable, the date must sit in the budget period, and a line must be a live line of that budget. Not a permission helper.';

REVOKE ALL ON FUNCTION finance_private.budget_xero_spends_before_write()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER budget_xero_spends_before_write
  BEFORE INSERT OR UPDATE ON public.budget_xero_spends
  FOR EACH ROW EXECUTE FUNCTION finance_private.budget_xero_spends_before_write();

CREATE TRIGGER budget_xero_spends_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_xero_spends
  FOR EACH ROW EXECUTE FUNCTION finance_private.finance_audit_row();


ALTER TABLE public.budget_xero_spends ENABLE ROW LEVEL SECURITY;

-- Same access as the budget_expenses sheet tracker (297 / 299).
-- Read: anyone who can see the budget. Write: finance edit-all, or an
-- editor member, via finance_private.can_record_budget_expenses.
-- No new permission key. No DELETE. service_role is granted the table
-- and bypasses RLS, which is how the receipt bot writes. Authenticated
-- policies are not opened wider than the tracker.
REVOKE ALL ON TABLE public.budget_xero_spends FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.budget_xero_spends TO authenticated, service_role;

CREATE POLICY budget_xero_spends_read
  ON public.budget_xero_spends
  FOR SELECT
  TO authenticated
  USING (
    finance_private.can_view_all_budgets()
    OR finance_private.is_budget_member(budget_id)
  );

CREATE POLICY budget_xero_spends_insert
  ON public.budget_xero_spends
  FOR INSERT
  TO authenticated
  WITH CHECK (finance_private.can_record_budget_expenses(budget_id));

CREATE POLICY budget_xero_spends_update
  ON public.budget_xero_spends
  FOR UPDATE
  TO authenticated
  USING (finance_private.can_record_budget_expenses(budget_id))
  WITH CHECK (finance_private.can_record_budget_expenses(budget_id));
