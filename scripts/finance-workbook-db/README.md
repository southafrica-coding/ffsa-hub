# Finance workbook database harness

Disposable Postgres on a Unix socket. It refuses `DATABASE_URL`, `SUPABASE_DB_URL`, `PGHOST`, and `PGPASSWORD`.

```bash
scripts/finance-workbook-db/run.sh
```

What it loads, in order:

1. `00-auth-fixture.sql` and `01-prerequisites.sql` (local stand-ins, not a replay of migrations 001–292).
2. PR #475 migrations 295–299 from `54fd09e0cd11974850bcb43b842c3ce5c697f1a6`. Migration 296 at that commit checks `budgets.currency = 'ZAR'`. The earlier lock `8e72e7e2` still allowed `USD` in that check; this harness does not load that file.
3. Baseline probes of direct SQL before migration 302 (`results/probe-results.tsv`).
4. Id-only `outreach_expenses` and `outreach_receipt_drafts` so #513's foreign keys can load. Those are not migrations 008 or 244.
5. PR #513 migrations 300 and 301 from `a985758c66761bfeba255e685437278a870c4fda`.
6. This branch's `supabase/migrations/302_budget_workbook_atomic_save.sql`.
7. Atomic save, ministry-leader, and #513 constraint probes.

`service_role` has `BYPASSRLS`, matching Supabase. `authenticated` does not. There is no PostgREST here, so a passing probe is not proof of a PostgREST embed.

Results are copied to `scripts/finance-workbook-db/results/`.
