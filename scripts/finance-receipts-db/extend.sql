-- Receipt schema on top of the pinned workbook harness.
-- Run only after scripts/finance-workbook-db/serve.sh from
-- f129e8aec5f02dab427a48e539fe972d178b5996 has loaded #475 54fd09e0,
-- the id-only outreach targets, #513 a985758c, and migration 303.
--
-- The base file 04-outreach-fk-targets.sql creates id-only
-- outreach_expenses and outreach_receipt_drafts. Those are replaced here
-- with the columns and policies the receipt services use.
--
-- Not loaded, and not claimed as covered:
--   008 cash batches, fund releases, closeouts, and the full category seed
--   264 cash_batch_id (needs outreach_cash_batches)
--   outreach_teams stays the harness stand-in (id, team_name). Production
--   008 also has program_id and created_by NOT NULL. Adding those now would
--   rewrite the base table this script does not own.

-- 069_slack_integration.sql: users.slack_user_id
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS slack_user_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_slack_user_id
  ON public.users (slack_user_id) WHERE slack_user_id IS NOT NULL;

-- 008_outreach_finance.sql categories, members, and is_outreach_team_member.
-- Role check is the later 260 set (owner, co_leader, team_member), which is
-- what confirmRepayment reads. The original 008 role list is not re-applied.
CREATE TABLE IF NOT EXISTS public.outreach_budget_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  description text,
  is_default  boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.outreach_budget_categories (name, slug, is_default, sort_order)
VALUES ('Food', 'food', true, 4)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.outreach_team_members (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id   uuid NOT NULL REFERENCES public.outreach_teams(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'team_member'
            CHECK (role IN ('owner', 'co_leader', 'team_member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_otm_one_owner
  ON public.outreach_team_members(team_id) WHERE role = 'owner';

CREATE OR REPLACE FUNCTION public.is_outreach_team_member(check_team_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.outreach_team_members
    WHERE team_id = check_team_id AND user_id = auth.uid()
  );
$$;

-- Replace the id-only foreign-key targets. Keep the #513 constraint names.
ALTER TABLE public.budget_xero_spends
  DROP CONSTRAINT IF EXISTS budget_xero_spends_receipt_draft_id_fkey;
ALTER TABLE public.budget_xero_spends
  DROP CONSTRAINT IF EXISTS budget_xero_spends_outreach_expense_id_fkey;
DROP TABLE IF EXISTS public.outreach_receipt_drafts;
DROP TABLE IF EXISTS public.outreach_expenses;

-- 008 expenses, without cash_batch_id. 244 source check included.
CREATE TABLE public.outreach_expenses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         uuid NOT NULL REFERENCES public.outreach_teams(id) ON DELETE CASCADE,
  category_id     uuid NOT NULL REFERENCES public.outreach_budget_categories(id),
  expense_date    date NOT NULL DEFAULT CURRENT_DATE,
  vendor          text,
  description     text NOT NULL,
  payment_method  text NOT NULL DEFAULT 'cash'
                  CHECK (payment_method IN ('cash', 'card', 'bank_transfer', 'reimbursement', 'prepayment')),
  local_currency  text NOT NULL DEFAULT 'ZAR',
  local_amount    numeric(12,2) NOT NULL,
  zar_amount      numeric(12,2) NOT NULL,
  exchange_rate   numeric(12,6) NOT NULL DEFAULT 1,
  source          text NOT NULL DEFAULT 'hub'
                  CHECK (source IN ('hub', 'import', 'slack')),
  created_by      uuid NOT NULL REFERENCES public.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.outreach_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read all expenses"
  ON public.outreach_expenses FOR SELECT
  USING (public.is_admin() OR public.has_role('finance_admin'));
CREATE POLICY "Members can read their team expenses"
  ON public.outreach_expenses FOR SELECT
  USING (public.is_outreach_team_member(team_id));

-- 244_outreach_slack_receipts.sql drafts, plus 262 nullable team_id and
-- 265 kind / confirmed_expense_id. cash_batch_id from 264 is omitted.
CREATE TABLE public.outreach_receipt_drafts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         uuid REFERENCES public.outreach_teams(id) ON DELETE CASCADE,
  hub_user_id     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  slack_user_id   text NOT NULL,
  channel_id      text NOT NULL,
  thread_ts       text,
  card_ts         text,
  user_note       text,
  slack_file_id   text,
  file_name       text NOT NULL,
  mime_type       text,
  file_size       integer,
  file_sha256     text NOT NULL,
  storage_path    text NOT NULL,
  extracted       jsonb,
  proposal        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('reading', 'pending', 'logging', 'logged', 'cancelled', 'failed')),
  kind            text NOT NULL DEFAULT 'receipt'
                  CHECK (kind IN ('receipt', 'cash_pull', 'card_confirm')),
  expense_id      uuid REFERENCES public.outreach_expenses(id) ON DELETE SET NULL,
  confirmed_expense_id uuid REFERENCES public.outreach_expenses(id) ON DELETE SET NULL,
  decided_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.outreach_receipt_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read receipt drafts"
  ON public.outreach_receipt_drafts FOR SELECT
  USING (
    public.is_admin()
    OR public.has_role('finance_admin')
    OR public.has_permission('finance.view')
    OR public.has_permission('finance.edit')
    OR public.is_outreach_team_member(team_id)
  );

ALTER TABLE public.budget_xero_spends
  ADD CONSTRAINT budget_xero_spends_receipt_draft_id_fkey
  FOREIGN KEY (receipt_draft_id) REFERENCES public.outreach_receipt_drafts(id) ON DELETE RESTRICT;
ALTER TABLE public.budget_xero_spends
  ADD CONSTRAINT budget_xero_spends_outreach_expense_id_fkey
  FOREIGN KEY (outreach_expense_id) REFERENCES public.outreach_expenses(id) ON DELETE SET NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.outreach_budget_categories,
  public.outreach_team_members,
  public.outreach_expenses,
  public.outreach_receipt_drafts
TO service_role;
GRANT SELECT ON
  public.outreach_budget_categories,
  public.outreach_team_members,
  public.outreach_expenses,
  public.outreach_receipt_drafts
TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_outreach_team_member(uuid) TO anon, authenticated, service_role;

-- auth.uid() for PostgREST is public.harness_pgrst_claims from the base
-- 00-auth-fixture.sql. This script does not replace that fixture.
