#!/usr/bin/env bash
# Disposable finance-workbook database. Unix socket only. Refuses anything else.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
# Latest #475 tip. 296 differs from the earlier lock 8e72e7e2: currency CHECK is ZAR only.
SHA475="54fd09e0cd11974850bcb43b842c3ce5c697f1a6"
SHA513="a985758c66761bfeba255e685437278a870c4fda"
BASE="${FFSA_VERIFY_ROOT:-/tmp/ffsa-workbook-verify}"
PGDATA="$BASE/data"
SOCKET="$BASE/socket"
LOG="$BASE/server.log"
DB="ffsa_workbook_verify"
PSQL_BIN="${PSQL_BIN:-/usr/lib/postgresql/16/bin/psql}"
PG_CTL="${PG_CTL:-/usr/lib/postgresql/16/bin/pg_ctl}"
INITDB="${INITDB:-/usr/lib/postgresql/16/bin/initdb}"

refuse() { echo "REFUSED: $*" >&2; exit 2; }

# No host, URL, or password may point this harness off the scratch socket.
if [[ -n "${DATABASE_URL:-}" || -n "${SUPABASE_DB_URL:-}" || -n "${PGHOST:-}" || -n "${PGPASSWORD:-}" ]]; then
  refuse "DATABASE_URL, SUPABASE_DB_URL, PGHOST, or PGPASSWORD is set. Unset them. This harness does not use external databases."
fi
case "$BASE" in
  /tmp/ffsa-workbook-verify*) ;;
  *) refuse "scratch root must stay under /tmp/ffsa-workbook-verify" ;;
esac
case "$DB" in
  *prod*|*production*|*supabase.co*) refuse "database name looks live" ;;
esac

mkdir -p "$BASE" "$SOCKET"
if [[ ! -f "$PGDATA/PG_VERSION" ]]; then
  "$INITDB" -D "$PGDATA" --auth-local trust --username="$(whoami)" --no-instructions
fi
if ! "$PG_CTL" -D "$PGDATA" status >/dev/null 2>&1; then
  "$PG_CTL" -D "$PGDATA" -l "$LOG" -o "-c listen_addresses='' -c unix_socket_directories=$SOCKET" start
fi

export PGHOST="$SOCKET"
export PGDATABASE="$DB"
PSQL=("$PSQL_BIN" -h "$SOCKET" -v ON_ERROR_STOP=1)

# Prove the server has no TCP listener address.
tcp="$("${PSQL[@]}" -d postgres -Atc "SELECT COALESCE(inet_server_addr()::text, 'none') || '|' || current_setting('listen_addresses');")"
case "$tcp" in
  none\|) ;;
  *) refuse "server is not socket-only (got $tcp)" ;;
esac

"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB;"
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $DB;"

echo "LOAD auth fixture"
"${PSQL[@]}" -d "$DB" -f "$ROOT/00-auth-fixture.sql"
echo "LOAD prerequisites"
"${PSQL[@]}" -d "$DB" -f "$ROOT/01-prerequisites.sql"

cache="$BASE/schema475"
mkdir -p "$cache"
sums="$BASE/checksums.txt"
: > "$sums"
for name in \
  295_finance_audit_permissions_periods.sql \
  296_budgets_core.sql \
  297_budget_expense_tracker.sql \
  298_budget_views.sql \
  299_budget_privilege_hardening.sql
do
  git -C "$REPO" show "$SHA475:supabase/migrations/$name" > "$cache/$name"
  sha256sum "$cache/$name" | awk -v n="$name" '{print n, $1}' | tee -a "$sums"
  echo "LOAD $name from $SHA475"
  "${PSQL[@]}" -d "$DB" -f "$cache/$name"
done

echo "LOAD seed"
"${PSQL[@]}" -d "$DB" -f "$ROOT/02-seed.sql"

echo "CHECKSUMS"
cat "$sums"
echo "PROBE baseline (before migration 302)"
FFSA_VERIFY_SOCKET="$SOCKET" FFSA_VERIFY_DB="$DB" "$ROOT/probe.sh"

echo "LOAD outreach fk targets (id only, not migrations 008 or 244)"
"${PSQL[@]}" -d "$DB" -f "$ROOT/04-outreach-fk-targets.sql"
for name in 300_budget_repayments.sql 301_budget_xero_spends.sql; do
  git -C "$REPO" show "$SHA513:supabase/migrations/$name" > "$cache/$name"
  sha256sum "$cache/$name" | awk -v n="$name" '{print n, $1}' | tee -a "$sums"
  echo "LOAD $name from $SHA513"
  "${PSQL[@]}" -d "$DB" -f "$cache/$name"
done
echo "LOAD 302_budget_workbook_atomic_save.sql from this branch"
sha256sum "$REPO/supabase/migrations/302_budget_workbook_atomic_save.sql" | awk '{print "302_budget_workbook_atomic_save.sql", $1}' | tee -a "$sums"
"${PSQL[@]}" -d "$DB" -f "$REPO/supabase/migrations/302_budget_workbook_atomic_save.sql"

echo "PROBE atomic"
FFSA_VERIFY_SOCKET="$SOCKET" FFSA_VERIFY_DB="$DB" "$ROOT/probe-atomic.sh"
echo "PROBE leader"
FFSA_VERIFY_SOCKET="$SOCKET" FFSA_VERIFY_DB="$DB" "$ROOT/probe-leader.sh"
echo "PROBE 513 constraints"
FFSA_VERIFY_SOCKET="$SOCKET" FFSA_VERIFY_DB="$DB" "$ROOT/probe-513.sh"
mkdir -p "$ROOT/results"
cp "$BASE"/probe-results.tsv "$BASE"/probe-atomic.tsv "$BASE"/probe-leader.tsv "$BASE"/probe-513.tsv "$sums" "$ROOT/results/"
echo "HARNESS_OK"
