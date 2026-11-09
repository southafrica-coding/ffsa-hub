#!/usr/bin/env bash
# Receipt service tests. Starts the pinned workbook serve.sh in a detached
# worktree, then replaces the id-only outreach targets on that database.
# Does not edit scripts/finance-workbook-db or migration 303.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
HARNESS_SHA="f129e8aec5f02dab427a48e539fe972d178b5996"
WT="${FFSA_HARNESS_WORKTREE:-/tmp/ffsa-harness-f129e8ae}"

refuse() { echo "REFUSED: $*" >&2; exit 2; }
if [[ -n "${DATABASE_URL:-}" || -n "${SUPABASE_DB_URL:-}" || -n "${PGHOST:-}" || -n "${PGPASSWORD:-}" ]]; then
  refuse "DATABASE_URL, SUPABASE_DB_URL, PGHOST, or PGPASSWORD is set."
fi

PSQL_BIN="${PSQL_BIN:-/usr/lib/postgresql/16/bin/psql}"
[[ -x "$PSQL_BIN" ]] || refuse "psql not found at $PSQL_BIN"
if [[ -x /tmp/ffsa-postgrest/postgrest && ! -x /tmp/postgrest ]]; then
  cp /tmp/ffsa-postgrest/postgrest /tmp/postgrest
  chmod +x /tmp/postgrest
fi

if [[ ! -d "$WT/scripts/finance-workbook-db/serve.sh" && ! -f "$WT/scripts/finance-workbook-db/serve.sh" ]]; then
  git -C "$REPO" worktree add --detach "$WT" "$HARNESS_SHA"
fi
got="$(git -C "$WT" rev-parse HEAD)"
if [[ "$got" != "$HARNESS_SHA" ]]; then
  refuse "worktree $WT is $got, expected $HARNESS_SHA"
fi

echo "SERVE pinned harness $HARNESS_SHA"
(cd "$WT" && scripts/finance-workbook-db/serve.sh)

# shellcheck disable=SC1091
set -a
source /tmp/ffsa-workbook-verify/postgrest.env
set +a
[[ -n "${FFSA_PGRST_URL:-}" && -n "${FFSA_VERIFY_SOCKET:-}" ]] || refuse "postgrest.env did not export the local URL"

echo "EXTEND receipt schema on the full database only"
"$PSQL_BIN" -h "$FFSA_VERIFY_SOCKET" -d ffsa_workbook_verify -v ON_ERROR_STOP=1 -f "$ROOT/extend.sql"
"$PSQL_BIN" -h "$FFSA_VERIFY_SOCKET" -d ffsa_workbook_verify -v ON_ERROR_STOP=1 -f "$ROOT/seed.sql"
"$PSQL_BIN" -h "$FFSA_VERIFY_SOCKET" -d ffsa_workbook_verify -c "NOTIFY pgrst, 'reload schema';"
sleep 0.4

export FFSA_RECEIPT_DB=1
cd "$REPO"
./node_modules/.bin/vitest run src/lib/finance/receipt-service.db.test.ts --reporter=verbose
