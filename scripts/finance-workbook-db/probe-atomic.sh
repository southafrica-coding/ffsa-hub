#!/usr/bin/env bash
# Calls apply_budget_workbook / create_budget_workbook_sheet as authenticated.
# Not the Next.js API and not PostgREST.
set -euo pipefail

SOCKET="${FFSA_VERIFY_SOCKET:?}"
DB="${FFSA_VERIFY_DB:?}"
PSQL=(/usr/lib/postgresql/16/bin/psql -h "$SOCKET" -d "$DB" -v ON_ERROR_STOP=1 -X)
OUT="${FFSA_VERIFY_ROOT:-/tmp/ffsa-workbook-verify}/probe-atomic.tsv"
: > "$OUT"
record() { printf '%s\t%s\t%s\n' "$1" "$2" "$3" | tee -a "$OUT"; }

FINANCE=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1
EDITOR=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2
APPROVER=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3
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

PERIOD="$("${PSQL[@]}" -At -c "SELECT id FROM public.fiscal_periods WHERE label = 'Harness 2027' LIMIT 1;")"
NPC="$("${PSQL[@]}" -At -c "SELECT id FROM public.finance_orgs WHERE key = 'npc';")"
TPL="$("${PSQL[@]}" -At -c "SELECT id FROM public.budget_templates WHERE key = 'team_standard';")"

BID="$(as_user "$FINANCE" "
SELECT public.create_budget_workbook_sheet(
  '$TPL'::uuid, 'program', '$PROGRAM'::uuid, '$PERIOD'::uuid, '$NPC'::uuid,
  'Atomic sheet', NULL, NULL, NULL, NULL,
  jsonb_build_array(
    jsonb_build_object('kind','fixed','name','Van','amount_cents',100,'frequency',1,'multiplier',1,'uses_driver',false,'sort',0),
    jsonb_build_object('kind','fixed','name','Fuel','amount_cents',100,'frequency',1,'multiplier',1,'uses_driver',false,'sort',1)
  ),
  NULL
)::text;
" | grep -E '^[0-9a-f-]{36}$' | tail -1)"
if [[ ! "$BID" =~ ^[0-9a-f-]{36}$ ]]; then
  record atomic_setup SETUP-ERROR "create_budget_workbook_sheet returned $BID"
  exit 1
fi
VAN="$("${PSQL[@]}" -At -c "SELECT id FROM public.budget_lines WHERE budget_id = '$BID' AND name = 'Van';")"
FUEL="$("${PSQL[@]}" -At -c "SELECT id FROM public.budget_lines WHERE budget_id = '$BID' AND name = 'Fuel';")"
REV="$("${PSQL[@]}" -At -c "
SELECT max(stamp) FROM (
  SELECT updated_at AS stamp FROM public.budgets WHERE id = '$BID'
  UNION ALL SELECT updated_at FROM public.budget_lines WHERE budget_id = '$BID' AND archived_at IS NULL
  UNION ALL SELECT updated_at FROM public.budget_expenses WHERE budget_id = '$BID' AND archived_at IS NULL
) s;")"

lines_json() {
  local van_name="$1"
  local fuel_name="$2"
  printf "jsonb_build_array(jsonb_build_object('id','%s','kind','fixed','name','%s','amount_cents',100,'frequency',1,'multiplier',1,'uses_driver',false,'sort',0),jsonb_build_object('id','%s','kind','fixed','name','%s','amount_cents',100,'frequency',1,'multiplier',1,'uses_driver',false,'sort',1))" "$VAN" "$van_name" "$FUEL" "$fuel_name"
}

cat > /tmp/ffsa-workbook-verify/atomic-a.sql <<SQL
SELECT set_config('request.jwt.claim.sub', '$FINANCE', false);
SET ROLE authenticated;
BEGIN;
SELECT public.apply_budget_workbook(
  '$BID'::uuid, '$REV'::timestamptz, NULL,
  $(lines_json "Van from A" "Fuel from A"),
  NULL
);
SELECT pg_sleep(3);
COMMIT;
SELECT 'A_DONE';
SQL
cat > /tmp/ffsa-workbook-verify/atomic-b.sql <<SQL
SELECT set_config('request.jwt.claim.sub', '$FINANCE', false);
SET ROLE authenticated;
SELECT public.apply_budget_workbook(
  '$BID'::uuid, '$REV'::timestamptz, NULL,
  $(lines_json "Van from B" "Fuel from B"),
  NULL
);
SELECT 'B_DONE';
SQL
"${PSQL[@]}" -f /tmp/ffsa-workbook-verify/atomic-a.sql > /tmp/ffsa-workbook-verify/atomic-a.out 2>&1 &
sleep 0.4
set +e
"${PSQL[@]}" -f /tmp/ffsa-workbook-verify/atomic-b.sql > /tmp/ffsa-workbook-verify/atomic-b.out 2>&1
set -e
wait || true
names="$("${PSQL[@]}" -At -c "SELECT name FROM public.budget_lines WHERE budget_id = '$BID' AND archived_at IS NULL ORDER BY sort, name;")"
if grep -q A_DONE /tmp/ffsa-workbook-verify/atomic-a.out \
  && grep -q "workbook revision conflict" /tmp/ffsa-workbook-verify/atomic-b.out \
  && printf '%s' "$names" | grep -q "Van from A" \
  && printf '%s' "$names" | grep -q "Fuel from A" \
  && ! printf '%s' "$names" | grep -q "from B"; then
  record sheet_one_transaction PASS "second session conflicted; both lines stayed session A ($names)"
else
  record sheet_one_transaction FAIL "names=$names a=$(tr '\n' ' ' < /tmp/ffsa-workbook-verify/atomic-a.out) b=$(tr '\n' ' ' < /tmp/ffsa-workbook-verify/atomic-b.out)"
fi

before="$("${PSQL[@]}" -At -c "SELECT count(*) FROM public.finance_audit_log;")"
REV2="$("${PSQL[@]}" -At -c "
SELECT max(stamp) FROM (
  SELECT updated_at AS stamp FROM public.budgets WHERE id = '$BID'
  UNION ALL SELECT updated_at FROM public.budget_lines WHERE budget_id = '$BID' AND archived_at IS NULL
) s;")"
as_user "$FINANCE" "
SELECT public.apply_budget_workbook(
  '$BID'::uuid, '$REV2'::timestamptz, NULL,
  $(lines_json "Van from A" "Fuel from A"),
  NULL
)::text;" >/dev/null
after="$("${PSQL[@]}" -At -c "SELECT count(*) FROM public.finance_audit_log;")"
if [[ "$before" == "$after" ]]; then
  record noop_function_no_audit PASS "unchanged apply added no audit row ($before)"
else
  record noop_function_no_audit FAIL "audit rows $before -> $after"
fi

SUB="$(as_user "$FINANCE" "
SELECT public.create_budget_workbook_sheet(
  '$TPL'::uuid, 'program', '$PROGRAM'::uuid, '$PERIOD'::uuid, '$NPC'::uuid,
  'Atomic submitted', NULL, NULL, NULL, NULL,
  jsonb_build_array(jsonb_build_object('id','dddddddd-dddd-4ddd-8ddd-ddddddddddd1','kind','fixed','name','Van','amount_cents',100,'frequency',1,'multiplier',1,'uses_driver',false,'sort',0)),
  NULL
)::text;" | grep -E '^[0-9a-f-]{36}$' | tail -1)"
as_user "$FINANCE" "
INSERT INTO public.budget_members (budget_id, user_id, role) VALUES ('$SUB', '$EDITOR', 'editor');
UPDATE public.budgets SET status = 'submitted' WHERE id = '$SUB';
" >/dev/null
SREV="$("${PSQL[@]}" -At -c "
SELECT max(stamp) FROM (
  SELECT updated_at AS stamp FROM public.budgets WHERE id = '$SUB'
  UNION ALL SELECT updated_at FROM public.budget_lines WHERE budget_id = '$SUB' AND archived_at IS NULL
) s;")"
as_user "$EDITOR" "
SELECT public.apply_budget_workbook(
  '$SUB'::uuid, '$SREV'::timestamptz, NULL,
  jsonb_build_array(jsonb_build_object('id','dddddddd-dddd-4ddd-8ddd-ddddddddddd1','kind','fixed','name','Van','amount_cents',100,'frequency',1,'multiplier',1,'uses_driver',false,'sort',0)),
  jsonb_build_array(jsonb_build_object('expense_date','2027-03-01','description','Bread','amount_cents',200))
)::text;" >/dev/null
bread="$("${PSQL[@]}" -At -c "SELECT count(*) FROM public.budget_expenses WHERE budget_id = '$SUB' AND description = 'Bread' AND archived_at IS NULL;")"
if [[ "$bread" == "1" ]]; then
  record editor_submitted_expense_function PASS "editor expense save committed one row and did not rewrite the line"
else
  record editor_submitted_expense_function FAIL "bread count=$bread"
fi

SREV3="$("${PSQL[@]}" -At -c "
SELECT max(stamp) FROM (
  SELECT updated_at AS stamp FROM public.budgets WHERE id = '$SUB'
  UNION ALL SELECT updated_at FROM public.budget_lines WHERE budget_id = '$SUB' AND archived_at IS NULL
  UNION ALL SELECT updated_at FROM public.budget_expenses WHERE budget_id = '$SUB' AND archived_at IS NULL
) s;")"
set +e
bad="$(as_user "$EDITOR" "
SELECT public.apply_budget_workbook(
  '$SUB'::uuid, '$SREV3'::timestamptz, NULL,
  jsonb_build_array(jsonb_build_object('id','dddddddd-dddd-4ddd-8ddd-ddddddddddd1','kind','fixed','name','Van','amount_cents',999,'frequency',1,'multiplier',1,'uses_driver',false,'sort',0)),
  jsonb_build_array(jsonb_build_object('expense_date','2027-04-01','description','Should roll back','amount_cents',50))
)::text;" 2>&1)"
set -e
amt="$("${PSQL[@]}" -At -c "SELECT amount_cents FROM public.budget_lines WHERE id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';")"
extra="$("${PSQL[@]}" -At -c "SELECT count(*) FROM public.budget_expenses WHERE budget_id = '$SUB' AND description = 'Should roll back';")"
if [[ "$amt" == "100" && "$extra" == "0" && "$bad" == *change* ]]; then
  record editor_line_change_rolls_back PASS "submitted line edit rolled back the expense too (amount=$amt)"
else
  record editor_line_change_rolls_back FAIL "amount=$amt extra=$extra err=$bad"
fi

as_user "$FINANCE" "
INSERT INTO public.budget_expenses (budget_id, line_id, expense_date, description, amount_cents)
VALUES ('$SUB', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', '2027-03-02', 'On the van', 20);
" >/dev/null
set +e
arch_err="$("${PSQL[@]}" -c "UPDATE public.budget_lines SET archived_at = now() WHERE id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';" 2>&1)"
set -e
still="$("${PSQL[@]}" -At -c "SELECT archived_at IS NULL FROM public.budget_lines WHERE id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';")"
if [[ "$still" == "t" && "$arch_err" == *live\ expense* ]]; then
  record archive_blocked_with_live_expense PASS "database refused to archive a line that a live expense points at"
else
  record archive_blocked_with_live_expense FAIL "still_live=$still err=$arch_err"
fi

echo "---- atomic ----"
column -t -s $'\t' "$OUT" || true
