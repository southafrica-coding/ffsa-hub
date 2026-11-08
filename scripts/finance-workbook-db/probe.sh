#!/usr/bin/env bash
# Direct PostgreSQL probes. Not the Next.js API and not Supabase HTTP.
# Identity is auth.uid() from request.jwt.claim.sub, then SET ROLE authenticated.
set -euo pipefail

SOCKET="${FFSA_VERIFY_SOCKET:?}"
DB="${FFSA_VERIFY_DB:?}"
PSQL=(/usr/lib/postgresql/16/bin/psql -h "$SOCKET" -d "$DB" -v ON_ERROR_STOP=1 -X)
OUT="${FFSA_VERIFY_ROOT:-/tmp/ffsa-workbook-verify}/probe-results.tsv"
: > "$OUT"

record() { printf '%s\t%s\t%s\n' "$1" "$2" "$3" | tee -a "$OUT"; }

FINANCE=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1
EDITOR=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2
APPROVER=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3
OUTSIDER=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4
PROGRAM=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1

as_user() {
  local uid="$1"
  local sql="$2"
  "${PSQL[@]}" -q -v ON_ERROR_STOP=1 -At <<SQL
DO \$\$ BEGIN PERFORM set_config('request.jwt.claim.sub', '$uid', false); END \$\$;
SET ROLE authenticated;
$sql
SQL
}

# Setup runs as the database owner, then switches per statement.
setup="$("${PSQL[@]}" -At <<SQL
SELECT set_config('request.jwt.claim.sub', '$FINANCE', false);
SET ROLE authenticated;
INSERT INTO public.fiscal_periods (org_id, label, kind, start_date, end_date)
SELECT id, 'Harness 2027', 'year', '2027-01-01', '2027-12-31'
FROM public.finance_orgs WHERE key = 'npc'
RETURNING id::text;
SQL
)"
PERIOD="$(echo "$setup" | grep -E '^[0-9a-f-]{36}$' | tail -1)"
if [[ ! "$PERIOD" =~ ^[0-9a-f-]{36}$ ]]; then
  record setup_period SETUP-ERROR "finance user could not insert a period: $setup"
  exit 1
fi

NPC="$("${PSQL[@]}" -At -c "SELECT id FROM public.finance_orgs WHERE key = 'npc';")"
TPL="$("${PSQL[@]}" -At -c "SELECT id FROM public.budget_templates WHERE key = 'team_standard';")"

make_budget() {
  local name="$1"
  as_user "$FINANCE" "
SELECT public.create_budget_from_template(
  '$TPL'::uuid, 'program', '$PROGRAM'::uuid, '$PERIOD'::uuid, '$NPC'::uuid,
  '$name', NULL, NULL, NULL, false
)::text;"
}

SUB_ID="$(make_budget "Submitted sheet" | grep -E '^[0-9a-f-]{36}$' | tail -1)"
APP_ID="$(make_budget "Approved sheet" | grep -E '^[0-9a-f-]{36}$' | tail -1)"
RACE_ID="$(make_budget "Race sheet" | grep -E '^[0-9a-f-]{36}$' | tail -1)"
if [[ ! "$SUB_ID" =~ ^[0-9a-f-]{36}$ || ! "$APP_ID" =~ ^[0-9a-f-]{36}$ || ! "$RACE_ID" =~ ^[0-9a-f-]{36}$ ]]; then
  record setup_budgets SETUP-ERROR "create_budget_from_template failed sub=$SUB_ID app=$APP_ID race=$RACE_ID"
  exit 1
fi

# Finance adds the editor. can_manage_budget is true for budget.edit_all.
as_user "$FINANCE" "
INSERT INTO public.budget_members (budget_id, user_id, role)
VALUES ('$SUB_ID', '$EDITOR', 'editor'), ('$APP_ID', '$EDITOR', 'editor');
UPDATE public.budgets SET status = 'submitted' WHERE id IN ('$SUB_ID', '$APP_ID');
" >/dev/null

as_user "$APPROVER" "
UPDATE public.budgets SET status = 'approved' WHERE id = '$APP_ID' AND status = 'submitted';
" >/dev/null

# Lines for the race sheet, as finance (draft, can edit lines).
as_user "$FINANCE" "
INSERT INTO public.budget_lines (budget_id, section_id, kind, name, amount_cents, frequency, multiplier)
SELECT '$RACE_ID', s.id, 'fixed', 'Van', 100, 1, 1
FROM public.budget_sections s WHERE s.budget_id = '$RACE_ID' AND s.key = 'fixed';
INSERT INTO public.budget_lines (budget_id, section_id, kind, name, amount_cents, frequency, multiplier)
SELECT '$RACE_ID', s.id, 'fixed', 'Fuel', 50, 1, 1
FROM public.budget_sections s WHERE s.budget_id = '$RACE_ID' AND s.key = 'fixed';
" >/dev/null

# --- RLS: editor on submitted ---
line_upd="$(as_user "$EDITOR" "
UPDATE public.budget_lines SET amount_cents = amount_cents + 1
 WHERE budget_id = '$SUB_ID' AND archived_at IS NULL
 RETURNING id;
" || true)"
if [[ -z "$(echo "$line_upd" | tr -d '[:space:]')" ]]; then
  record rls_editor_submitted_line_edit PASS "authenticated editor updated 0 submitted lines"
else
  record rls_editor_submitted_line_edit FAIL "editor changed a submitted line: $line_upd"
fi

exp_ins="$(as_user "$EDITOR" "
INSERT INTO public.budget_expenses (budget_id, expense_date, description, amount_cents)
VALUES ('$SUB_ID', '2027-02-01', 'Fuel', 500)
RETURNING id::text;
")"
if [[ "$exp_ins" =~ [0-9a-f-]{36} ]]; then
  record rls_editor_submitted_expense PASS "authenticated editor inserted a submitted expense"
else
  record rls_editor_submitted_expense FAIL "expense insert failed: $exp_ins"
fi

# --- RLS: editor on approved ---
line_app="$(as_user "$EDITOR" "
UPDATE public.budget_lines SET amount_cents = amount_cents + 1
 WHERE budget_id = '$APP_ID' AND archived_at IS NULL
 RETURNING id;
" || true)"
if [[ -z "$(echo "$line_app" | tr -d '[:space:]')" ]]; then
  record rls_editor_approved_line_edit PASS "authenticated editor updated 0 approved lines"
else
  record rls_editor_approved_line_edit FAIL "editor changed an approved line: $line_app"
fi

exp_app="$(as_user "$EDITOR" "
INSERT INTO public.budget_expenses (budget_id, expense_date, description, amount_cents)
VALUES ('$APP_ID', '2027-03-01', 'Bread', 200)
RETURNING id::text;
")"
if [[ "$exp_app" =~ [0-9a-f-]{36} ]]; then
  record rls_editor_approved_expense PASS "authenticated editor inserted an approved expense"
else
  record rls_editor_approved_expense FAIL "approved expense insert failed: $exp_app"
fi

out_exp="$(as_user "$OUTSIDER" "
INSERT INTO public.budget_expenses (budget_id, expense_date, description, amount_cents)
VALUES ('$SUB_ID', '2027-04-01', 'Nope', 100)
RETURNING id::text;
" 2>&1 || true)"
if [[ "$out_exp" =~ [0-9a-f-]{36} ]]; then
  record rls_outsider_expense FAIL "outsider inserted an expense"
else
  record rls_outsider_expense PASS "outsider insert did not return an id"
fi

who="$("${PSQL[@]}" -At <<SQL
SELECT set_config('request.jwt.claim.sub', '$EDITOR', false);
SET ROLE authenticated;
SELECT current_user || '|' || COALESCE(auth.uid()::text, 'null');
SQL
)"
who="$(echo "$who" | grep '|' | tail -1)"
if [[ "$who" == "authenticated|$EDITOR" ]]; then
  record rls_identity PASS "SET ROLE authenticated and auth.uid() is the editor fixture"
else
  record rls_identity FAIL "identity was $who"
fi

# Superuser bypass is recorded separately, not as an RLS pass.
su_n="$("${PSQL[@]}" -At -c "UPDATE public.budget_lines SET notes = 'owner bypass' WHERE budget_id = '$SUB_ID' AND archived_at IS NULL RETURNING id;" | wc -l)"
record superuser_bypasses_rls PASS "table owner updated $su_n submitted lines; this is not an authenticated result"

# --- no-op UPDATE still audits (trigger). Service skip is not executed. ---
before="$("${PSQL[@]}" -At -c "SELECT count(*) FROM public.finance_audit_log WHERE budget_id = '$RACE_ID';")"
"${PSQL[@]}" -c "UPDATE public.budget_lines SET amount_cents = amount_cents WHERE budget_id = '$RACE_ID' AND name = 'Van';" >/dev/null
after="$("${PSQL[@]}" -At -c "SELECT count(*) FROM public.finance_audit_log WHERE budget_id = '$RACE_ID';")"
if [[ "$after" -gt "$before" ]]; then
  record noop_update_audit_churn FAIL "no-op UPDATE added $((after - before)) audit row(s); trigger does not skip unchanged writes"
else
  record noop_update_audit_churn PASS "no-op UPDATE added no audit row"
fi

# --- separate statements leave a partial row (app cleanup not invoked) ---
partial_line="$("${PSQL[@]}" -At <<SQL
SELECT set_config('request.jwt.claim.sub', '$FINANCE', false);
SET ROLE authenticated;
INSERT INTO public.budget_lines (budget_id, section_id, kind, name, amount_cents)
SELECT '$RACE_ID', s.id, 'fixed', 'Partial', 10
FROM public.budget_sections s WHERE s.budget_id = '$RACE_ID' AND s.key = 'fixed'
RETURNING id::text;
SQL
)"
partial_line="$(echo "$partial_line" | grep -E '^[0-9a-f-]{36}$' | tail -1)"
set +e
"${PSQL[@]}" -c "INSERT INTO public.budget_expenses (budget_id, expense_date, description, amount_cents, line_id) VALUES ('$RACE_ID', '2027-01-01', 'bad', 10, '00000000-0000-4000-8000-000000000000');" >/tmp/ffsa-workbook-verify/bad-expense.err 2>&1
bad_rc=$?
set -e
still="$("${PSQL[@]}" -At -c "SELECT count(*) FROM public.budget_lines WHERE id = '$partial_line' AND archived_at IS NULL;")"
if [[ "$bad_rc" -ne 0 && "$still" == "1" ]]; then
  record separate_statements_leave_partial FAIL "failed expense left line $partial_line live; no partial_draft id was returned by SQL"
else
  record separate_statements_leave_partial SETUP-ERROR "rc=$bad_rc still=$still line=$partial_line"
fi

# --- database allows archiving a line that still has a live expense ---
exp_line="$partial_line"
as_user "$FINANCE" "
INSERT INTO public.budget_expenses (budget_id, line_id, expense_date, description, amount_cents)
VALUES ('$RACE_ID', '$exp_line', '2027-05-01', 'Against partial', 20);
" >/dev/null
arch="$("${PSQL[@]}" -At -c "UPDATE public.budget_lines SET archived_at = now() WHERE id = '$exp_line' RETURNING id;")"
live_exp="$("${PSQL[@]}" -At -c "SELECT count(*) FROM public.budget_expenses WHERE line_id = '$exp_line' AND archived_at IS NULL;")"
if [[ -n "$arch" && "$live_exp" != "0" ]]; then
  record db_allows_archive_with_live_expense FAIL "archived line $exp_line while $live_exp live expense(s) remain; no FK forbids it"
else
  record db_allows_archive_with_live_expense PASS "archive did not leave a live expense (arch=$arch live=$live_exp)"
fi

# --- simultaneous sessions ---
VAN="$("${PSQL[@]}" -At -c "SELECT id FROM public.budget_lines WHERE budget_id = '$RACE_ID' AND name = 'Van' AND archived_at IS NULL;")"
FUEL="$("${PSQL[@]}" -At -c "SELECT id FROM public.budget_lines WHERE budget_id = '$RACE_ID' AND name = 'Fuel' AND archived_at IS NULL;")"
VAN_TS="$("${PSQL[@]}" -At -c "SELECT updated_at FROM public.budget_lines WHERE id = '$VAN';")"

# Unconditional overlap: both succeed, last commit wins.
cat > /tmp/ffsa-workbook-verify/race-a.sql <<SQL
SELECT set_config('request.jwt.claim.sub', '$FINANCE', false);
SET ROLE authenticated;
BEGIN;
UPDATE public.budget_lines SET amount_cents = 111 WHERE id = '$VAN';
SELECT pg_sleep(4);
COMMIT;
SELECT 'A_DONE', amount_cents FROM public.budget_lines WHERE id = '$VAN';
SQL
cat > /tmp/ffsa-workbook-verify/race-b.sql <<SQL
SELECT set_config('request.jwt.claim.sub', '$FINANCE', false);
SET ROLE authenticated;
BEGIN;
UPDATE public.budget_lines SET amount_cents = 222 WHERE id = '$VAN';
COMMIT;
SELECT 'B_DONE', amount_cents FROM public.budget_lines WHERE id = '$VAN';
SQL
"${PSQL[@]}" -f /tmp/ffsa-workbook-verify/race-a.sql > /tmp/ffsa-workbook-verify/race-a.out 2>&1 &
sleep 0.4
"${PSQL[@]}" -f /tmp/ffsa-workbook-verify/race-b.sql > /tmp/ffsa-workbook-verify/race-b.out 2>&1
wait || true
final_plain="$("${PSQL[@]}" -At -c "SELECT amount_cents FROM public.budget_lines WHERE id = '$VAN';")"
if grep -q A_DONE /tmp/ffsa-workbook-verify/race-a.out && grep -q B_DONE /tmp/ffsa-workbook-verify/race-b.out; then
  record unconditional_overlap_lost_update FAIL "both sessions committed an amount write; final amount_cents=$final_plain (last writer wins, not one atomic sheet)"
else
  record unconditional_overlap_lost_update SETUP-ERROR "a=$(tr '\n' ' ' < /tmp/ffsa-workbook-verify/race-a.out) b=$(tr '\n' ' ' < /tmp/ffsa-workbook-verify/race-b.out)"
fi

# CAS overlap on Fuel. Refresh timestamp after any earlier trigger touch.
FUEL_TS="$("${PSQL[@]}" -At -c "SELECT updated_at FROM public.budget_lines WHERE id = '$FUEL';")"
cat > /tmp/ffsa-workbook-verify/cas-a.sql <<SQL
SELECT set_config('request.jwt.claim.sub', '$FINANCE', false);
SET ROLE authenticated;
BEGIN;
WITH u AS (
  UPDATE public.budget_lines SET amount_cents = 400
  WHERE id = '$FUEL' AND updated_at = '$FUEL_TS'
  RETURNING id
)
SELECT 'A_CAS', count(*) FROM u;
SELECT pg_sleep(4);
COMMIT;
SQL
cat > /tmp/ffsa-workbook-verify/cas-b.sql <<SQL
SELECT set_config('request.jwt.claim.sub', '$FINANCE', false);
SET ROLE authenticated;
BEGIN;
WITH u AS (
  UPDATE public.budget_lines SET amount_cents = 800
  WHERE id = '$FUEL' AND updated_at = '$FUEL_TS'
  RETURNING id
)
SELECT 'B_CAS', count(*) FROM u;
COMMIT;
SQL
"${PSQL[@]}" -f /tmp/ffsa-workbook-verify/cas-a.sql > /tmp/ffsa-workbook-verify/cas-a.out 2>&1 &
sleep 0.4
"${PSQL[@]}" -f /tmp/ffsa-workbook-verify/cas-b.sql > /tmp/ffsa-workbook-verify/cas-b.out 2>&1
wait || true
a_cas="$(awk '/A_CAS/{print $3; exit}' /tmp/ffsa-workbook-verify/cas-a.out || true)"
b_cas="$(awk '/B_CAS/{print $3; exit}' /tmp/ffsa-workbook-verify/cas-b.out || true)"
# psql aligned output may put the count on the next line. Fall back to a simple parse.
if [[ -z "$a_cas" ]]; then a_cas="$(grep -A1 A_CAS /tmp/ffsa-workbook-verify/cas-a.out | tail -1 | tr -cd '0-9')"; fi
if [[ -z "$b_cas" ]]; then b_cas="$(grep -A1 B_CAS /tmp/ffsa-workbook-verify/cas-b.out | tail -1 | tr -cd '0-9')"; fi
cas_sum=$(( ${a_cas:-0} + ${b_cas:-0} ))
if [[ "$cas_sum" == "1" ]]; then
  record per_row_cas_overlap PASS "overlapping CAS updates changed the row once (A=$a_cas B=$b_cas); not a sheet transaction"
else
  record per_row_cas_overlap FAIL "expected exactly one CAS winner, A=$a_cas B=$b_cas; see cas-a.out cas-b.out"
fi

# Two sessions, two rows, both commit. Sheet is not one version.
cat > /tmp/ffsa-workbook-verify/cross-a.sql <<SQL
SELECT set_config('request.jwt.claim.sub', '$FINANCE', false);
SET ROLE authenticated;
UPDATE public.budget_lines SET notes = 'from-a' WHERE id = '$VAN';
SELECT 'CROSS_A', 1;
SQL
cat > /tmp/ffsa-workbook-verify/cross-b.sql <<SQL
SELECT set_config('request.jwt.claim.sub', '$FINANCE', false);
SET ROLE authenticated;
UPDATE public.budget_lines SET notes = 'from-b' WHERE id = '$FUEL';
SELECT 'CROSS_B', 1;
SQL
"${PSQL[@]}" -f /tmp/ffsa-workbook-verify/cross-a.sql > /tmp/ffsa-workbook-verify/cross-a.out 2>&1 &
"${PSQL[@]}" -f /tmp/ffsa-workbook-verify/cross-b.sql > /tmp/ffsa-workbook-verify/cross-b.out 2>&1 &
wait || true
notes="$("${PSQL[@]}" -At -c "SELECT name || '=' || COALESCE(notes,'') FROM public.budget_lines WHERE id IN ('$VAN','$FUEL') ORDER BY name;")"
if grep -q CROSS_A /tmp/ffsa-workbook-verify/cross-a.out && grep -q CROSS_B /tmp/ffsa-workbook-verify/cross-b.out; then
  record sheet_not_one_transaction FAIL "two sessions committed different rows ($notes); no sheet-wide atomicity"
else
  record sheet_not_one_transaction SETUP-ERROR "cross session output missing"
fi

echo "---- results ----"
column -t -s $'\t' "$OUT" || cat "$OUT"
echo "---- counts ----"
awk -F'\t' '{c[$2]++} END {for (k in c) print k, c[k]}' "$OUT" | sort
