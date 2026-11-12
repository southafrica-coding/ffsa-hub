# Finance workbook database harness

Disposable Postgres on a Unix socket. It refuses `DATABASE_URL`, `SUPABASE_DB_URL`, `PGHOST`, and `PGPASSWORD`.

```bash
scripts/finance-workbook-db/run.sh
scripts/finance-workbook-db/integrate.sh
```

`run.sh` reloads the pinned schema and runs the SQL probes. `integrate.sh` reloads that same schema (full, without migration 303, and without the budgets table), starts PostgREST on 127.0.0.1 ports 3001–3003, and runs the Next route handlers. `serve.sh` is the same startup without the route tests, and writes `/tmp/ffsa-workbook-verify/postgrest.env` for another draft to use. Neither script reads production credentials.

What it loads, in order:

1. `00-auth-fixture.sql` and `01-prerequisites.sql` (local stand-ins, not a replay of migrations 001–292).
2. PR #475 migrations 295–299 from `54fd09e0cd11974850bcb43b842c3ce5c697f1a6`. Migration 296 at that commit checks `budgets.currency = 'ZAR'`. The earlier lock `8e72e7e2` still allowed `USD` in that check; this harness does not load that file.
3. Baseline probes of direct SQL before migration 303 (`results/probe-results.tsv`). Those failures stay in that file. They are not counted as passes.
4. Id-only `outreach_expenses` and `outreach_receipt_drafts` so #513's foreign keys can load. Those are not migrations 008 or 244.
5. PR #513 migrations 300 and 301 from `a985758c66761bfeba255e685437278a870c4fda`.
6. This branch's `supabase/migrations/303_budget_workbook_atomic_save.sql`. Migration 302 is `302_communications_rls_orphan_keys.sql` on draft #514 (`42a88aab`) and is not loaded here.
7. Atomic save, ministry-leader, and #513 constraint probes.

`service_role` has `BYPASSRLS`, matching Supabase. `authenticated` does not. The `run.sh` probes are direct SQL, not PostgREST.

`results/postgrest-http.txt` is a separate local HTTP check against this same disposable database after `run.sh`. PostgREST 16.5 was downloaded with `gh release download v16.5 --repo PostgREST/postgrest --pattern postgrest-v16.5-linux-static-x86-64.tar.xz`. `apt-get install postgrest` is not packaged here, and a direct GitHub asset URL returned HTTP 504. The Next.js routes were not executed against this database. The check adds `public.harness_pgrst_claims` on the disposable database only, so `auth.uid()` can read the JWT `sub`. That function is not in migration 303.

Results are copied to `scripts/finance-workbook-db/results/`.
