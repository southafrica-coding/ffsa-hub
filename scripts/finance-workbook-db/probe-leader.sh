#!/usr/bin/env bash
# Ministry leader, authenticated, with finance_orgs hidden by policy 290.
# Org validity is the insert trigger, not a service-role read.
set -euo pipefail

SOCKET="${FFSA_VERIFY_SOCKET:?}"
DB="${FFSA_VERIFY_DB:?}"
PSQL=(/usr/lib/postgresql/16/bin/psql -h "$SOCKET" -d "$DB" -v ON_ERROR_STOP=1 -X)
OUT="${FFSA_VERIFY_ROOT:-/tmp/ffsa-workbook-verify}/probe-leader.tsv"
: > "$OUT"
record() { printf '%s\t%s\t%s\n' "$1" "$2" "$(printf '%s' "$3" | tr '\n' ' ')" | tee -a "$OUT"; }

LEADER=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5
MINISTRY=cccccccc-cccc-4ccc-8ccc-ccccccccccc1

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

seen="$(as_user "$LEADER" "SELECT count(*) FROM public.finance_orgs;")"
who="$(as_user "$LEADER" "SELECT current_user || '|' || COALESCE(auth.uid()::text, 'null');" | grep '|' | tail -1)"
if [[ "$seen" == "0" && "$who" == "authenticated|$LEADER" ]]; then
  record leader_cannot_read_finance_orgs PASS "authenticated leader sees 0 finance_orgs rows ($who)"
else
  record leader_cannot_read_finance_orgs FAIL "seen=$seen who=$who"
fi

BID="$(as_user "$LEADER" "
SELECT public.create_budget_workbook_sheet(
  '$TPL'::uuid, 'staff_ministry', '$MINISTRY'::uuid, '$PERIOD'::uuid, '$NPC'::uuid,
  'Leader sheet', NULL, NULL, NULL, NULL,
  jsonb_build_array(jsonb_build_object('kind','fixed','name','Van','amount_cents',100,'frequency',1,'multiplier',1,'uses_driver',false,'sort',0)),
  NULL
)::text;" | grep -E '^[0-9a-f-]{36}$' | tail -1)"
org="$("${PSQL[@]}" -At -c "SELECT org_id FROM public.budgets WHERE id = '$BID';" 2>/dev/null || true)"
role="$(as_user "$LEADER" "SELECT role FROM public.budget_members WHERE budget_id = '$BID' AND user_id = '$LEADER';")"
if [[ "$BID" =~ ^[0-9a-f-]{36}$ && "$org" == "$NPC" && "$role" == "owner" ]]; then
  record leader_create PASS "leader created $BID on the period org without reading finance_orgs"
else
  record leader_create FAIL "id=$BID org=$org role=$role"
fi

LINE="$(as_user "$LEADER" "SELECT id FROM public.budget_lines WHERE budget_id = '$BID' AND archived_at IS NULL;")"
REV="$(as_user "$LEADER" "SELECT revision FROM public.budget_workbook_revisions WHERE budget_id = '$BID';")"
as_user "$LEADER" "
SELECT public.apply_budget_workbook(
  '$BID'::uuid, '$REV'::timestamptz, NULL,
  jsonb_build_array(jsonb_build_object('id','$LINE','kind','fixed','name','Van','amount_cents',250,'frequency',1,'multiplier',1,'uses_driver',false,'sort',0)),
  NULL
)::text;" >/dev/null
amt="$(as_user "$LEADER" "SELECT amount_cents FROM public.budget_lines WHERE id = '$LINE';")"
if [[ "$amt" == "250" ]]; then
  record leader_load_save PASS "leader loaded the line and saved 250 cents"
else
  record leader_load_save FAIL "amount=$amt line=$LINE"
fi

"${PSQL[@]}" -c "UPDATE public.finance_orgs SET is_active = false WHERE key = 'npc';" >/dev/null
REV2="$(as_user "$LEADER" "SELECT revision FROM public.budget_workbook_revisions WHERE budget_id = '$BID';")"
ok="$(as_user "$LEADER" "SELECT public.budget_workbook_org_ok('$BID'::uuid);")"
set +e
save_err="$(as_user "$LEADER" "
SELECT public.apply_budget_workbook(
  '$BID'::uuid, '$REV2'::timestamptz, NULL,
  jsonb_build_array(jsonb_build_object('id','$LINE','kind','fixed','name','Van','amount_cents',260,'frequency',1,'multiplier',1,'uses_driver',false,'sort',0)),
  NULL
)::text;" 2>&1)"
second="$(as_user "$LEADER" "
SELECT public.create_budget_workbook_sheet(
  '$TPL'::uuid, 'staff_ministry', '$MINISTRY'::uuid, '$PERIOD'::uuid, '$NPC'::uuid,
  'Leader sheet two', NULL, NULL, NULL, NULL, NULL, NULL
)::text;" 2>&1)"
set -e
amt2="$(as_user "$LEADER" "SELECT amount_cents FROM public.budget_lines WHERE id = '$LINE';")"
"${PSQL[@]}" -c "UPDATE public.finance_orgs SET is_active = true WHERE key = 'npc';" >/dev/null
live="$("${PSQL[@]}" -At -c "SELECT count(*) FROM public.budgets WHERE name = 'Leader sheet two' AND archived_at IS NULL;")"
if [[ "$ok" == "f" && "$amt2" == "250" && "$live" == "0" && "$save_err" == *active\ South\ Africa* && "$second" == *South\ Africa* ]]; then
  record leader_inactive_org PASS "leader read and save fail closed while NPC is inactive; amount stayed 250"
else
  record leader_inactive_org FAIL "ok=$ok amount=$amt2 live=$live save=$save_err create=$second"
fi

echo "---- leader ----"
column -t -s $'\t' "$OUT" || true
