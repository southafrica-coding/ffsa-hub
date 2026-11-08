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

for port in 3001 3002 3003; do
  tmux -f /exec-daemon/tmux.portal.conf kill-session -t "pgrst-${port}" 2>/dev/null || true
done
"${PSQL[@]}" -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB' AND pid <> pg_backend_pid();" >/dev/null || true
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB;"
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $DB;"

# shellcheck disable=SC1091
source "$ROOT/schema-load.sh"
load_pinned_schema "$DB" 475
sums="$BASE/checksums-${DB}.txt"
echo "CHECKSUMS"
cat "$sums"
echo "PROBE baseline (before migration 303)"
FFSA_VERIFY_SOCKET="$SOCKET" FFSA_VERIFY_DB="$DB" "$ROOT/probe.sh"
load_pinned_after_475 "$DB" 303

echo "PROBE atomic"
FFSA_VERIFY_SOCKET="$SOCKET" FFSA_VERIFY_DB="$DB" "$ROOT/probe-atomic.sh"
echo "PROBE leader"
FFSA_VERIFY_SOCKET="$SOCKET" FFSA_VERIFY_DB="$DB" "$ROOT/probe-leader.sh"
echo "PROBE 513 constraints"
FFSA_VERIFY_SOCKET="$SOCKET" FFSA_VERIFY_DB="$DB" "$ROOT/probe-513.sh"
mkdir -p "$ROOT/results"
cp "$BASE"/probe-results.tsv "$BASE"/probe-atomic.tsv "$BASE"/probe-leader.tsv "$BASE"/probe-513.tsv "$ROOT/results/"
cp "$sums" "$ROOT/results/checksums.txt"
echo "HARNESS_OK"
