-- ID-ONLY foreign-key targets so migration 301 can load.
-- These are not the tables from 008_outreach_finance.sql or
-- 244_outreach_slack_receipts.sql. Their columns, checks, and policies
-- are not applied here. Probes that mention these tables only need a
-- primary key for budget_xero_spends.receipt_draft_id and
-- budget_xero_spends.outreach_expense_id.

CREATE TABLE IF NOT EXISTS public.outreach_expenses (
  id uuid PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS public.outreach_receipt_drafts (
  id uuid PRIMARY KEY
);

REVOKE ALL ON public.outreach_expenses, public.outreach_receipt_drafts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.outreach_expenses, public.outreach_receipt_drafts TO service_role;
