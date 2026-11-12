#!/usr/bin/env bash
# Workbook Next route handlers against disposable PostgREST.
# Session/cookie lookup is not GoTrue. See the integration test header.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
"$ROOT/serve.sh"
# shellcheck disable=SC1091
set -a
source "${FFSA_VERIFY_ROOT:-/tmp/ffsa-workbook-verify}/postgrest.env"
set +a
cd "$REPO"
npx vitest run src/services/budget-workbook.integration.test.ts
