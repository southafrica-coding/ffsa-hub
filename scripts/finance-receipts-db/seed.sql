-- Rows for the receipt service tests. Database owner. auth.uid() is null,
-- so the budget status change is not a user approval. The #475 insert
-- trigger still requires the active NPC rand org.

INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6', 'receipt-owner@example.test'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7', 'receipt-claim@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, display_name, slack_user_id) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6', 'Receipt owner', 'URECEIPTOWN'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7', 'Receipt claimant', 'URECEIPTCLM')
ON CONFLICT (id) DO NOTHING;

UPDATE public.users SET slack_user_id = 'UOUTSIDER1'
WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';

INSERT INTO public.outreach_teams (id, team_name)
VALUES ('11111111-1111-4111-8111-111111111111', 'Receipt team');

INSERT INTO public.outreach_team_members (team_id, user_id, role) VALUES
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6', 'owner'),
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7', 'team_member');

INSERT INTO public.fiscal_periods (org_id, label, kind, start_date, end_date)
SELECT id, 'Receipt service year', 'year',
  date_trunc('year', CURRENT_DATE)::date,
  (date_trunc('year', CURRENT_DATE) + interval '1 year' - interval '1 day')::date
FROM public.finance_orgs WHERE key = 'npc';

SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', false);

SELECT public.create_budget_from_template(
  (SELECT id FROM public.budget_templates WHERE key = 'team_standard'),
  'outreach_team',
  '11111111-1111-4111-8111-111111111111',
  (SELECT id FROM public.fiscal_periods WHERE label = 'Receipt service year'),
  (SELECT id FROM public.finance_orgs WHERE key = 'npc'),
  'Receipt service book',
  NULL, NULL, NULL, false
);

UPDATE public.budgets SET status = 'submitted' WHERE name = 'Receipt service book';
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', false);
UPDATE public.budgets SET status = 'approved' WHERE name = 'Receipt service book' AND status = 'submitted';

INSERT INTO public.budget_lines (budget_id, section_id, kind, name, amount_cents)
SELECT b.id, s.id, 'fixed', 'Food', 100000
FROM public.budgets b
JOIN public.budget_sections s ON s.budget_id = b.id AND s.key = 'fixed'
WHERE b.name = 'Receipt service book';

INSERT INTO public.budget_members (budget_id, user_id, role)
SELECT id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', 'viewer'
FROM public.budgets WHERE name = 'Receipt service book';

INSERT INTO public.xero_accounts (
  id, org_region, tenant_id, xero_account_id, code, name, status
) VALUES (
  '22222222-2222-4222-8222-222222222222',
  'za', 'test-tenant', 'test-account', '400', 'Food', 'active'
);

INSERT INTO public.budget_line_coding (line_id, org_region, account_id, source)
SELECT l.id, 'za', '22222222-2222-4222-8222-222222222222', 'finance_override'
FROM public.budget_lines l
JOIN public.budgets b ON b.id = l.budget_id
WHERE b.name = 'Receipt service book' AND l.name = 'Food';

INSERT INTO public.outreach_expenses (
  id, team_id, category_id, expense_date, description,
  payment_method, local_currency, local_amount, zar_amount, source, created_by
) VALUES (
  '33333333-3333-4333-8333-333333333333',
  '11111111-1111-4111-8111-111111111111',
  (SELECT id FROM public.outreach_budget_categories WHERE slug = 'food'),
  CURRENT_DATE, 'Food', 'card', 'ZAR', 12.00, 12.00, 'slack',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6'
);

INSERT INTO public.outreach_receipt_drafts (
  id, team_id, hub_user_id, slack_user_id, channel_id, file_name, file_sha256,
  storage_path, proposal, status, expense_id
)
SELECT
  'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
  'URECEIPTOWN',
  'DTEST',
  'slip.jpg',
  'abc123',
  'receipts/slip.jpg',
  jsonb_build_object(
    'description', 'Food',
    'vendor', 'Shop',
    'expense_date', to_char(CURRENT_DATE, 'YYYY-MM-DD'),
    'zar_amount', 12,
    'zar_confirmed', true,
    'local_currency', 'ZAR',
    'local_amount', 12,
    'payment_method', 'card',
    'budget_id', b.id,
    'budget_line_id', l.id,
    'budget_line_label', 'Food',
    'budget_status', 'approved',
    'budget_period_start', to_char(p.start_date, 'YYYY-MM-DD'),
    'budget_period_end', to_char(p.end_date, 'YYYY-MM-DD')
  ),
  'logged',
  '33333333-3333-4333-8333-333333333333'
FROM public.budgets b
JOIN public.fiscal_periods p ON p.id = b.period_id
JOIN public.budget_lines l ON l.budget_id = b.id AND l.name = 'Food'
WHERE b.name = 'Receipt service book';
