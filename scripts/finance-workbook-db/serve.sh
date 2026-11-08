#!/usr/bin/env bash
# Start the pinned disposable schema and local PostgREST for workbook and #507 tests.
# Does not run the probe suite. Does not use production URLs or credentials.
# Prints shell exports. Leaves Postgres and PostgREST running.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
SHA475="54fd09e0cd11974850bcb43b842c3ce5c697f1a6"
SHA513="a985758c66761bfeba255e685437278a870c4fda"
SHA507="2e1bcaec401c4675cee9f7c8533f6b23f365a3c0"
BASE="${FFSA_VERIFY_ROOT:-/tmp/ffsa-workbook-verify}"
SOCKET="$BASE/socket"
DB="ffsa_workbook_verify"
DB_NOFN="ffsa_workbook_nofn"
DB_NOTABLE="ffsa_workbook_notable"
PSQL_BIN="${PSQL_BIN:-/usr/lib/postgresql/16/bin/psql}"
PG_CTL="${PG_CTL:-/usr/lib/postgresql/16/bin/pg_ctl}"
INITDB="${INITDB:-/usr/lib/postgresql/16/bin/initdb}"
JWT_SECRET="local-harness-secret-not-production"
PGRST_BIN="${PGRST_BIN:-$BASE/postgrest}"

refuse() { echo "REFUSED: $*" >&2; exit 2; }
if [[ -n "${DATABASE_URL:-}" || -n "${SUPABASE_DB_URL:-}" || -n "${PGHOST:-}" || -n "${PGPASSWORD:-}" ]]; then
  refuse "DATABASE_URL, SUPABASE_DB_URL, PGHOST, or PGPASSWORD is set. Unset them. This harness does not use external databases."
fi
case "$BASE" in
  /tmp/ffsa-workbook-verify*) ;;
  *) refuse "scratch root must stay under /tmp/ffsa-workbook-verify" ;;
esac

mkdir -p "$BASE" "$SOCKET"
if [[ ! -f "$BASE/data/PG_VERSION" ]]; then
  "$INITDB" -D "$BASE/data" --auth-local trust --username="$(whoami)" --no-instructions
fi
if ! "$PG_CTL" -D "$BASE/data" status >/dev/null 2>&1; then
  "$PG_CTL" -D "$BASE/data" -l "$BASE/server.log" -o "-c listen_addresses='' -c unix_socket_directories=$SOCKET" start
fi

# Dropping a database fails while PostgREST from a previous serve is connected.
for port in 3001 3002 3003; do
  tmux -f /exec-daemon/tmux.portal.conf kill-session -t "pgrst-${port}" 2>/dev/null || true
done
sleep 0.3

PSQL=("$PSQL_BIN" -h "$SOCKET" -v ON_ERROR_STOP=1)
tcp="$("${PSQL[@]}" -d postgres -Atc "SELECT COALESCE(inet_server_addr()::text, 'none') || '|' || current_setting('listen_addresses');")"
case "$tcp" in
  none\|) ;;
  *) refuse "server is not socket-only (got $tcp)" ;;
esac

# shellcheck disable=SC1091
source "$ROOT/schema-load.sh"
recreate() {
  local name="$1"
  local stop="$2"
  "${PSQL[@]}" -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$name' AND pid <> pg_backend_pid();" >/dev/null || true
  "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $name;"
  "${PSQL[@]}" -d postgres -c "CREATE DATABASE $name;"
  load_pinned_schema "$name" "$stop"
}

echo "PINNED LOAD full=$DB stop=303"
recreate "$DB" 303
echo "PINNED LOAD no-function=$DB_NOFN stop=513"
recreate "$DB_NOFN" 513
echo "PINNED LOAD no-table=$DB_NOTABLE stop=prereq"
recreate "$DB_NOTABLE" prereq

order="$BASE/pinned-dependency-order.txt"
{
  echo "order:"
  echo "  1. scripts/finance-workbook-db/00-auth-fixture.sql"
  echo "  2. scripts/finance-workbook-db/01-prerequisites.sql"
  echo "  3. scripts/finance-workbook-db/02-seed.sql"
  echo "  4. #475 $SHA475 migrations 295 296 297 298 299"
  echo "  5. scripts/finance-workbook-db/04-outreach-fk-targets.sql (id-only, not 008 or 244)"
  echo "  6. #513 $SHA513 migrations 300 301"
  echo "  7. this branch supabase/migrations/303_budget_workbook_atomic_save.sql"
  echo "not loaded: #514 302_communications_rls_orphan_keys.sql (42a88aab)"
  echo "not loaded: #507 $SHA507 (read for compatibility, not applied)"
  echo "bank mapping: unset, not inferred"
  echo "#507 head files were not modified"
} > "$order"
"${PSQL[@]}" -d "$DB" -Atc "
SELECT 'fn ' || p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('create_budget_from_template','create_budget_workbook_sheet','apply_budget_workbook','budget_workbook_org_ok','budget_workbook_periods')
 ORDER BY 1;
SELECT 'rel ' || to_regclass(c) FROM (VALUES ('public.budgets'),('public.budget_expenses'),('public.budget_repayments'),('public.budget_xero_spends'),('public.budget_workbook_revisions')) v(c);
SELECT 'con ' || conname FROM pg_constraint WHERE conname IN ('budgets_period_org_fkey','budget_repayments_slack_message_ts_key','budget_xero_spends_receipt_draft_key');
" >> "$order"
if git -C "$REPO" cat-file -e "$SHA507^{commit}" 2>/dev/null; then
  if git -C "$REPO" grep -q "budgets_period_org_fkey" "$SHA507" -- src/services/budget-actuals.ts; then
    echo "#507 $SHA507 budget-actuals.ts selects fiscal_periods!budgets_period_org_fkey" >> "$order"
  fi
fi
cp "$order" "$ROOT/results/pinned-dependency-order.txt"

if [[ ! -x "$PGRST_BIN" ]]; then
  if [[ -x /tmp/postgrest ]]; then
    cp /tmp/postgrest "$PGRST_BIN"
  else
    gh release download v16.5 --repo PostgREST/postgrest --pattern 'postgrest-v16.5-linux-static-x86-64.tar.xz' --dir "$BASE"
    tar -xJf "$BASE/postgrest-v16.5-linux-static-x86-64.tar.xz" -C "$BASE"
    mv "$BASE/postgrest" "$PGRST_BIN" 2>/dev/null || true
  fi
fi
[[ -x "$PGRST_BIN" ]] || refuse "PostgREST binary missing at $PGRST_BIN"

start_pgrst() {
  local db="$1"
  local port="$2"
  local conf="$BASE/postgrest-${port}.conf"
  cat > "$conf" <<EOF
db-uri = "postgresql:///${db}?host=${SOCKET}"
db-schemas = "public"
db-anon-role = "anon"
db-pre-request = "public.harness_pgrst_claims"
jwt-secret = "${JWT_SECRET}"
server-host = "127.0.0.1"
server-port = ${port}
EOF
  local session="pgrst-${port}"
  tmux -f /exec-daemon/tmux.portal.conf has-session -t "$session" 2>/dev/null && tmux -f /exec-daemon/tmux.portal.conf kill-session -t "$session"
  tmux -f /exec-daemon/tmux.portal.conf new-session -d -s "$session" -- "$PGRST_BIN" "$conf"
}

start_pgrst "$DB" 3001
start_pgrst "$DB_NOFN" 3002
start_pgrst "$DB_NOTABLE" 3003
sleep 0.6

envfile="$BASE/postgrest.env"
cat > "$envfile" <<EOF
FFSA_PGRST_URL=http://127.0.0.1:3001
FFSA_PGRST_NOFN_URL=http://127.0.0.1:3002
FFSA_PGRST_NOTABLE_URL=http://127.0.0.1:3003
FFSA_PGRST_JWT_SECRET=${JWT_SECRET}
FFSA_VERIFY_SOCKET=${SOCKET}
EOF
echo "SERVE_OK"
cat "$envfile"
echo "dependency order:"
cat "$order"
