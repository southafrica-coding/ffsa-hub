#!/usr/bin/env bash
# #513 constraints from a985758c, after #475. Direct SQL, two sessions.
# outreach_receipt_drafts here is the id-only target, not migration 244.
set -euo pipefail

SOCKET="${FFSA_VERIFY_SOCKET:?}"
DB="${FFSA_VERIFY_DB:?}"
PSQL=(/usr/lib/postgresql/16/bin/psql -h "$SOCKET" -d "$DB" -v ON_ERROR_STOP=1 -X)
OUT="${FFSA_VERIFY_ROOT:-/tmp/ffsa-workbook-verify}/probe-513.tsv"
: > "$OUT"
record() { printf '%s\t%s\t%s\n' "$1" "$2" "$3" | tee -a "$OUT"; }

FINANCE=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1
OUTSIDER=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4
PROGRAM=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1
DRAFT1=eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1
DRAFT2=eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2

as_user() {
  local uid="$1"
  local sql="$2"
  "${PSQL[@]}" -q -v ON_ERROR_STOP=1 -At <<SQL
DO \$\$ BEGIN PERFORM set_config('request.jwt.claim.sub', '$uid', false); END \$\$;
SET ROLE authenticated;
$sql
SQL
}

as_service() {
  local sql="$1"
  "${PSQL[@]}" -q -v ON_ERROR_STOP=1 -At <<SQL
SET ROLE service_role;
$sql
SQL
}

PERIOD="$("${PSQL[@]}" -At -c "SELECT id FROM public.fiscal_periods WHERE label = 'Harness 2027' LIMIT 1;")"
NPC="$("${PSQL[@]}" -At -c "SELECT id FROM public.finance_orgs WHERE key = 'npc';")"
USA="$("${PSQL[@]}" -At -c "SELECT id FROM public.finance_orgs WHERE key = 'usa';")"
TPL="$("${PSQL[@]}" -At -c "SELECT id FROM public.budget_templates WHERE key = 'team_standard';")"
BID="$(as_user "$FINANCE" "
SELECT public.create_budget_from_template(
  '$TPL'::uuid, 'program', '$PROGRAM'::uuid, '$PERIOD'::uuid, '$NPC'::uuid,
  'Receipt log sheet', NULL, NULL, NULL, false
)::text;" | grep -E '^[0-9a-f-]{36}$' | tail -1)"
LINE="$(as_user "$FINANCE" "
INSERT INTO public.budget_lines (budget_id, section_id, kind, name, amount_cents, frequency, multiplier)
SELECT '$BID', id, 'fixed', 'Van', 100, 1, 1 FROM public.budget_sections
WHERE budget_id = '$BID' AND key = 'fixed'
RETURNING id::text;" | grep -E '^[0-9a-f-]{36}$' | tail -1)"

check="$(${PSQL[@]} -At -c "
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'public.budgets'::regclass AND contype = 'c'
  AND pg_get_constraintdef(oid) ILIKE '%currency%';")"
fk="$("${PSQL[@]}" -At -c "SELECT count(*) FROM pg_constraint WHERE conname = 'budgets_period_org_fkey';")"
if [[ "$check" == *"= 'ZAR'"* && "$check" != *USD* && "$fk" == "1" ]]; then
  record npc_currency_check PASS "budgets.currency CHECK is ZAR only and budgets_period_org_fkey exists ($check)"
else
  record npc_currency_check FAIL "check=$check fk=$fk"
fi

cols="$("${PSQL[@]}" -At -c "
SELECT coalesce(string_agg(column_name, ','), '')
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('budget_repayments', 'budget_xero_spends')
  AND column_name IN ('org_key', 'currency');")"
if [[ -z "$cols" ]]; then
  record no_org_key_or_currency PASS "budget_repayments and budget_xero_spends have no org_key or currency column"
else
  record no_org_key_or_currency FAIL "found $cols"
fi

set +e
usd="$(as_user "$FINANCE" "
INSERT INTO public.budgets (name, template_id, template_version, period_id, org_id, currency, owner_kind, program_id)
VALUES ('USD try', '$TPL', 1, '$PERIOD', '$NPC', 'USD', 'program', '$PROGRAM');" 2>&1)"
set -e
usd_rows="$("${PSQL[@]}" -At -c "SELECT count(*) FROM public.budgets WHERE name = 'USD try';")"
if [[ "$usd_rows" == "0" && "$usd" == *ZAR* ]]; then
  record reject_usd_currency PASS "authenticated finance USD insert was rejected and left no row"
else
  record reject_usd_currency FAIL "rows=$usd_rows err=$usd"
fi

cat > /tmp/ffsa-workbook-verify/slack-a.sql <<SQL
SELECT set_config('request.jwt.claim.sub', '$FINANCE', false);
SET ROLE authenticated;
BEGIN;
INSERT INTO public.budget_repayments (budget_id, hub_user_id, slack_message_ts, amount_cents, description)
VALUES ('$BID', '$FINANCE', '1710000000.000100', 100, 'No receipt');
SELECT pg_sleep(2);
COMMIT;
SELECT 'A_DONE';
SQL
cat > /tmp/ffsa-workbook-verify/slack-b.sql <<SQL
SELECT set_config('request.jwt.claim.sub', '$FINANCE', false);
SET ROLE authenticated;
INSERT INTO public.budget_repayments (budget_id, hub_user_id, slack_message_ts, amount_cents, description)
VALUES ('$BID', '$FINANCE', '1710000000.000100', 100, 'No receipt again');
SELECT 'B_DONE';
SQL
"${PSQL[@]}" -f /tmp/ffsa-workbook-verify/slack-a.sql > /tmp/ffsa-workbook-verify/slack-a.out 2>&1 &
sleep 0.3
set +e
"${PSQL[@]}" -f /tmp/ffsa-workbook-verify/slack-b.sql > /tmp/ffsa-workbook-verify/slack-b.out 2>&1
set -e
wait || true
reps="$("${PSQL[@]}" -At -c "SELECT count(*) FROM public.budget_repayments WHERE slack_message_ts = '1710000000.000100';")"
if grep -q A_DONE /tmp/ffsa-workbook-verify/slack-a.out && grep -q "budget_repayments_slack_message_ts_key" /tmp/ffsa-workbook-verify/slack-b.out && [[ "$reps" == "1" ]]; then
  record duplicate_slack_message_ts PASS "second session failed the unique slack_message_ts; one row remains"
else
  record duplicate_slack_message_ts FAIL "rows=$reps a=$(tr '\n' ' ' < /tmp/ffsa-workbook-verify/slack-a.out) b=$(tr '\n' ' ' < /tmp/ffsa-workbook-verify/slack-b.out)"
fi

"${PSQL[@]}" -c "INSERT INTO public.outreach_receipt_drafts (id) VALUES ('$DRAFT1'), ('$DRAFT2');" >/dev/null
as_user "$FINANCE" "
INSERT INTO public.budget_xero_spends (budget_id, line_id, receipt_draft_id, amount_cents, spent_on, description, has_receipt, xero_status)
VALUES ('$BID', '$LINE', '$DRAFT1', 500, '2027-04-01', 'Fuel', true, 'written');" >/dev/null
set +e
dup="$(as_user "$FINANCE" "
INSERT INTO public.budget_xero_spends (budget_id, line_id, receipt_draft_id, amount_cents, spent_on, description, has_receipt, xero_status)
VALUES ('$BID', '$LINE', '$DRAFT1', 500, '2027-04-02', 'Fuel again', true, 'written');" 2>&1)"
bounds="$(as_user "$FINANCE" "
INSERT INTO public.budget_xero_spends (budget_id, amount_cents, spent_on, description, has_receipt, xero_status)
VALUES ('$BID', 500, '2020-01-01', 'Too early', true, 'written');" 2>&1)"
set -e
as_user "$FINANCE" "
INSERT INTO public.budget_xero_spends (budget_id, amount_cents, spent_on, description, has_receipt, xero_status)
VALUES
  ('$BID', 100, '2027-05-01', 'No draft one', true, 'written'),
  ('$BID', 100, '2027-05-02', 'No draft two', true, 'written');" >/dev/null
nulls="$("${PSQL[@]}" -At -c "SELECT count(*) FROM public.budget_xero_spends WHERE budget_id = '$BID' AND receipt_draft_id IS NULL;")"
drafts="$("${PSQL[@]}" -At -c "SELECT count(*) FROM public.budget_xero_spends WHERE receipt_draft_id = '$DRAFT1';")"
if [[ "$drafts" == "1" && "$nulls" == "2" && "$dup" == *budget_xero_spends_receipt_draft_key* && "$bounds" == *budget\ period* ]]; then
  record xero_spend_constraints PASS "duplicate receipt_draft_id rejected, date outside the period rejected, two null drafts allowed"
else
  record xero_spend_constraints FAIL "drafts=$drafts nulls=$nulls dup=$dup bounds=$bounds"
fi

set +e
outsider="$(as_user "$OUTSIDER" "
INSERT INTO public.budget_xero_spends (budget_id, amount_cents, spent_on, description, has_receipt, xero_status)
VALUES ('$BID', 100, '2027-06-01', 'Outsider', true, 'written');" 2>&1)"
set -e
svc="$(as_service "
INSERT INTO public.budget_xero_spends (budget_id, receipt_draft_id, amount_cents, spent_on, description, has_receipt, xero_status)
VALUES ('$BID', '$DRAFT2', 100, '2027-06-02', 'Bot', true, 'written')
RETURNING current_user;")"
if [[ "$outsider" == *row-level\ security* || "$outsider" == *42501* || "$outsider" == *permission* ]] && [[ "$svc" == *service_role* ]]; then
  record authenticated_vs_service_role PASS "outsider insert failed; service_role insert ran as $svc"
else
  record authenticated_vs_service_role FAIL "outsider=$outsider service=$svc"
fi

echo "---- 513 ----"
column -t -s $'\t' "$OUT" || true
