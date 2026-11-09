# Receipt service database checks

Uses the workbook harness read-only. The pinned entry is `scripts/finance-workbook-db/serve.sh` at `f129e8aec5f02dab427a48e539fe972d178b5996`. This directory does not modify that script or migration 303.

```bash
scripts/finance-receipts-db/run.sh
```

`run.sh` checks out that commit in `/tmp/ffsa-harness-f129e8ae` and runs `serve.sh` there. `serve.sh` refuses `DATABASE_URL`, `SUPABASE_DB_URL`, `PGHOST`, and `PGPASSWORD`. It writes `/tmp/ffsa-workbook-verify/postgrest.env`:

- `FFSA_PGRST_URL` — full schema, PostgREST on 127.0.0.1:3001
- `FFSA_PGRST_NOFN_URL` — stopped before migration 303, port 3002
- `FFSA_PGRST_NOTABLE_URL` — prerequisites only, no budget tables, port 3003

Load order is the harness file `results/pinned-dependency-order.txt`: auth fixture, prerequisites, seed after 295, #475 `54fd09e0` migrations 295–299, id-only outreach foreign keys, #513 `a985758c` migrations 300–301, migration 303.

`extend.sql` then replaces those id-only `outreach_expenses` and `outreach_receipt_drafts` tables on the full database. The replacement uses the columns and row-level policies from migrations 008, 069, 244, 260, and 265 that the receipt services actually touch. It does not load cash batches (264), closeouts, or the full 008 category list. `outreach_teams` stays the harness stand-in (`id`, `team_name`); production 008 also requires `program_id` and `created_by`.

`src/lib/finance/receipt-service.db.test.ts` calls the real service and the actuals route. The cookie and `getUser` boundary is a local HMAC JWT, the same shape as the workbook integration test. After that, queries go through supabase-js to local PostgREST (`/rest/v1` stripped) and Postgres. Slack and Xero HTTP are not called. `createXeroSpendMoney` and `listXeroSpendTransactions` are mocked. `XERO_SPEND_BANK_ACCOUNT_ZA` is set to `TEST-ONLY-NOT-PRODUCTION` inside one test and removed again. It is not a real bank code.

The #513 SQL probes (duplicate `slack_message_ts`, period bounds, duplicate `receipt_draft_id`) stay in the base harness. These tests are the service path on top of that.
