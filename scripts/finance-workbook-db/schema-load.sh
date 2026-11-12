# Sourced by run.sh and serve.sh. Loads one disposable database.
# Args: database name, stop point: prereq | 475 | 513 | 303
# Uses ROOT, REPO, SHA475, SHA513, SOCKET, PSQL, BASE from the caller.
load_pinned_schema() {
  local target_db="$1"
  local stop="$2"
  local cache="$BASE/schema475"
  local sums="$BASE/checksums-${target_db}.txt"
  mkdir -p "$cache"
  : > "$sums"

  echo "LOAD auth fixture into $target_db"
  "${PSQL[@]}" -d "$target_db" -f "$ROOT/00-auth-fixture.sql"
  echo "LOAD prerequisites into $target_db"
  "${PSQL[@]}" -d "$target_db" -f "$ROOT/01-prerequisites.sql"
  if [[ "$stop" == "prereq" ]]; then
    echo "LOAD seed into $target_db"
    "${PSQL[@]}" -d "$target_db" -f "$ROOT/02-seed.sql"
    echo "STOP $target_db before #475 (no budgets table)"
    return 0
  fi

  local name
  for name in \
    295_finance_audit_permissions_periods.sql \
    296_budgets_core.sql \
    297_budget_expense_tracker.sql \
    298_budget_views.sql \
    299_budget_privilege_hardening.sql
  do
    git -C "$REPO" show "$SHA475:supabase/migrations/$name" > "$cache/$name"
    sha256sum "$cache/$name" | awk -v n="$name" '{print n, $1}' | tee -a "$sums"
    echo "LOAD $name from $SHA475 into $target_db"
    "${PSQL[@]}" -d "$target_db" -f "$cache/$name"
  done
  # 295 creates budget_approver. Seed must run after that so the approver's role lands.
  echo "LOAD seed into $target_db"
  "${PSQL[@]}" -d "$target_db" -f "$ROOT/02-seed.sql"
  if [[ "$stop" == "475" ]]; then
    echo "STOP $target_db after #475 295-299"
    return 0
  fi

  echo "LOAD outreach fk targets into $target_db (id only, not migrations 008 or 244)"
  "${PSQL[@]}" -d "$target_db" -f "$ROOT/04-outreach-fk-targets.sql"
  for name in 300_budget_repayments.sql 301_budget_xero_spends.sql; do
    git -C "$REPO" show "$SHA513:supabase/migrations/$name" > "$cache/$name"
    sha256sum "$cache/$name" | awk -v n="$name" '{print n, $1}' | tee -a "$sums"
    echo "LOAD $name from $SHA513 into $target_db"
    "${PSQL[@]}" -d "$target_db" -f "$cache/$name"
  done
  if [[ "$stop" == "513" ]]; then
    echo "STOP $target_db after #513 300-301 (no migration 303)"
    return 0
  fi

  echo "LOAD 303_budget_workbook_atomic_save.sql from this branch into $target_db"
  sha256sum "$REPO/supabase/migrations/303_budget_workbook_atomic_save.sql" | awk '{print "303_budget_workbook_atomic_save.sql", $1}' | tee -a "$sums"
  "${PSQL[@]}" -d "$target_db" -f "$REPO/supabase/migrations/303_budget_workbook_atomic_save.sql"
}

# 475 is already loaded. Adds #513 then, unless stop is 513, migration 303.
load_pinned_after_475() {
  local target_db="$1"
  local stop="$2"
  local cache="$BASE/schema475"
  local sums="$BASE/checksums-${target_db}.txt"
  local name
  echo "LOAD outreach fk targets into $target_db (id only, not migrations 008 or 244)"
  "${PSQL[@]}" -d "$target_db" -f "$ROOT/04-outreach-fk-targets.sql"
  for name in 300_budget_repayments.sql 301_budget_xero_spends.sql; do
    git -C "$REPO" show "$SHA513:supabase/migrations/$name" > "$cache/$name"
    sha256sum "$cache/$name" | awk -v n="$name" '{print n, $1}' | tee -a "$sums"
    echo "LOAD $name from $SHA513 into $target_db"
    "${PSQL[@]}" -d "$target_db" -f "$cache/$name"
  done
  if [[ "$stop" == "513" ]]; then
    echo "STOP $target_db after #513 300-301 (no migration 303)"
    return 0
  fi
  echo "LOAD 303_budget_workbook_atomic_save.sql from this branch into $target_db"
  sha256sum "$REPO/supabase/migrations/303_budget_workbook_atomic_save.sql" | awk '{print "303_budget_workbook_atomic_save.sql", $1}' | tee -a "$sums"
  "${PSQL[@]}" -d "$target_db" -f "$REPO/supabase/migrations/303_budget_workbook_atomic_save.sql"
}
