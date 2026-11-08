#!/usr/bin/env bash
# Drive the budget sheet UI through the Next workbook routes on a disposable
# Postgres + PostgREST. This does not start, write, or deploy production.
#
# Dependency pins (contract of Hub Backend #522, unchanged at this head):
#   #522 f129e8aec5f02dab427a48e539fe972d178b5996
#        supabase/migrations/303_budget_workbook_atomic_save.sql
#   #475 54fd09e0cd11974850bcb43b842c3ce5c697f1a6
#        migrations 295 296 297 298 299
#   #513 a985758c66761bfeba255e685437278a870c4fda
#        migrations 300 and 301
# Never load #514 migration 302.
# XERO_SPEND_BANK_ACCOUNT_ZA stays unset.
#
# Session boundary: FFSA_HARNESS=1 replaces the cookie session and
# auth.getUser() with a local HMAC subject. That is not GoTrue, and the
# browser does not hold a Supabase session. Queries still go through the
# real route handlers to local PostgREST and Postgres, including RLS for
# that stubbed subject.
#
# The backend files are copied into a disposable git worktree under /tmp.
# They are not committed on this branch and this script does not push them.

set -euo pipefail

for name in DATABASE_URL SUPABASE_DB_URL PGHOST PGPASSWORD; do
  if [ -n "${!name:-}" ]; then
    echo "refusing: ${name} is set" >&2
    exit 2
  fi
done

if [ "${VERCEL_ENV:-}" = "preview" ] || [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "refusing: VERCEL_ENV=${VERCEL_ENV}" >&2
  exit 2
fi

UI_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="${FFSA_522_DIR:-/tmp/ffsa-522}"
WORKTREE="${FFSA_UI_WORKTREE:-/tmp/ffsa-ui-budget}"
PORT="${FFSA_UI_PORT:-3010}"
HEAD_522="f129e8aec5f02dab427a48e539fe972d178b5996"

if [ ! -d "$BACKEND/scripts/finance-workbook-db" ]; then
  echo "refusing: backend checkout missing at ${BACKEND}" >&2
  exit 2
fi

backend_head="$(git -C "$BACKEND" rev-parse HEAD)"
if [ "$backend_head" != "$HEAD_522" ]; then
  echo "refusing: backend HEAD ${backend_head} is not ${HEAD_522}" >&2
  exit 2
fi

if ! (echo >/dev/tcp/127.0.0.1/3001) >/dev/null 2>&1; then
  echo "starting disposable PostgREST from ${BACKEND}"
  (cd "$BACKEND" && bash scripts/finance-workbook-db/serve.sh)
fi

if [ -d "$WORKTREE" ]; then
  git -C "$UI_ROOT" worktree remove --force "$WORKTREE" >/dev/null 2>&1 || rm -rf "$WORKTREE"
fi
git -C "$UI_ROOT" worktree add --detach "$WORKTREE" HEAD

ln -sfn "$UI_ROOT/node_modules" "$WORKTREE/node_modules"

copy() {
  mkdir -p "$WORKTREE/$(dirname "$1")"
  cp "$BACKEND/$1" "$WORKTREE/$1"
}
copy src/app/api/finance/budgets/route.ts
copy "src/app/api/finance/budgets/[id]/route.ts"
copy src/services/budget-workbook.ts
copy src/lib/finance/budget-workbook.ts
copy src/lib/finance/preview-service-write.ts

cat >"$WORKTREE/src/lib/supabase/harness-client.ts" <<'EOF'
import { createHmac } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

function token(sub: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ role: "authenticated", sub, exp: 1893456000 })).toString("base64url");
  const data = `${header}.${payload}`;
  const sig = createHmac("sha256", process.env.FFSA_PGRST_JWT_SECRET || "local-harness-secret-not-production")
    .update(data)
    .digest("base64url");
  return `${data}.${sig}`;
}

/** Local PostgREST client for FFSA_HARNESS only. getUser is the cookie subject, not GoTrue. */
export async function harnessClientFromCookies() {
  const jar = await cookies();
  const sub = jar.get("ffsa-harness-sub")?.value;
  const url = process.env.FFSA_PGRST_URL;
  if (!sub || !url) return null;
  const jwt = token(sub);
  const client = createClient(url, jwt, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (input, init) => {
        const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        return fetch(raw.replace("/rest/v1", ""), init);
      },
    },
  });
  client.auth.getUser = (async () => ({ data: { user: { id: sub } }, error: null })) as typeof client.auth.getUser;
  return client;
}
EOF

python3 - "$WORKTREE" <<'PY'
import pathlib, sys
root = pathlib.Path(sys.argv[1])
server = root / "src/lib/supabase/server.ts"
text = server.read_text()
needle = "export const createClient = cache(async () => {\n"
insert = needle + """  if (process.env.FFSA_HARNESS === "1") {
    const { harnessClientFromCookies } = await import("./harness-client");
    const harness = await harnessClientFromCookies();
    if (harness) return harness as unknown as CookieClient;
  }

"""
if needle not in text:
    raise SystemExit("server.ts createClient not found")
server.write_text(text.replace(needle, insert, 1))

middle = root / "src/middleware.ts"
text = middle.read_text()
needle = "  const isApi = pathname === \"/api\" || pathname.startsWith(\"/api/\");\n"
insert = needle + """
  if (process.env.FFSA_HARNESS === "1") {
    const sub = request.cookies.get("ffsa-harness-sub")?.value;
    if (sub) {
      const active = await harnessAccountActive(sub);
      if (active === false) {
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        url.searchParams.set("error", "deactivated");
        return NextResponse.redirect(url);
      }
      if (active === null) {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
      }
      return NextResponse.next();
    }
  }

"""
if needle not in text:
    raise SystemExit("middleware isApi line not found")
if "async function harnessAccountActive" not in text:
    insert += """
async function harnessAccountActive(sub: string): Promise<boolean | null> {
  const secret = process.env.FFSA_PGRST_JWT_SECRET || "local-harness-secret-not-production";
  const url = process.env.FFSA_PGRST_URL;
  if (!url) return null;
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })).replace(/=/g, "").replace(/\\+/g, "-").replace(/\\//g, "_");
  const payload = btoa(JSON.stringify({ role: "authenticated", sub, exp: 1893456000 })).replace(/=/g, "").replace(/\\+/g, "-").replace(/\\//g, "_");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const raw = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(header + "." + payload));
  const sig = btoa(String.fromCharCode(...new Uint8Array(raw))).replace(/=/g, "").replace(/\\+/g, "-").replace(/\\//g, "_");
  const res = await fetch(url + "/users?id=eq." + sub + "&select=is_active", {
    headers: { Authorization: "Bearer " + header + "." + payload + "." + sig, Accept: "application/json" },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  if (!Array.isArray(rows) || !rows[0]) return null;
  return rows[0].is_active !== false;
}

"""
middle.write_text(text.replace(needle, insert, 1))
PY

# The profile gate is the real one. The harness only replaces getUser.
# A deactivated account is still sent to /login by the check above, which
# reads is_active from the disposable database.

export FFSA_HARNESS=1
export FFSA_PGRST_URL="${FFSA_PGRST_URL:-http://127.0.0.1:3001}"
export FFSA_PGRST_JWT_SECRET="${FFSA_PGRST_JWT_SECRET:-local-harness-secret-not-production}"
export NEXT_PUBLIC_SUPABASE_URL="$FFSA_PGRST_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="local-harness-not-a-secret"
unset VERCEL_ENV || true

SESSION="budget-ui-next"
tmux -f /exec-daemon/tmux.portal.conf has-session -t "=$SESSION" 2>/dev/null && tmux -f /exec-daemon/tmux.portal.conf kill-session -t "=$SESSION"
tmux -f /exec-daemon/tmux.portal.conf new-session -d -s "$SESSION" -c "$WORKTREE" -- bash -lc "export FFSA_HARNESS=1 FFSA_PGRST_URL='${FFSA_PGRST_URL}' FFSA_PGRST_JWT_SECRET='${FFSA_PGRST_JWT_SECRET}' NEXT_PUBLIC_SUPABASE_URL='${NEXT_PUBLIC_SUPABASE_URL}' NEXT_PUBLIC_SUPABASE_ANON_KEY='${NEXT_PUBLIC_SUPABASE_ANON_KEY}'; unset VERCEL_ENV DATABASE_URL SUPABASE_DB_URL PGHOST PGPASSWORD; exec ./node_modules/.bin/next dev -p ${PORT} -H 127.0.0.1"

echo "waiting for Next on ${PORT}"
ready=""
for _ in $(seq 1 90); do
  code="$(curl -s -o /dev/null -w '%{http_code}' -H 'Cookie: ffsa-harness-sub=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' "http://127.0.0.1:${PORT}/finance/budgets" || true)"
  if [ "$code" = "200" ] || [ "$code" = "307" ] || [ "$code" = "308" ]; then
    ready="$code"
    break
  fi
  sleep 2
done

if [ -z "$ready" ]; then
  echo "Next did not become ready. Last response was not 200/307/308." >&2
  tmux -f /exec-daemon/tmux.portal.conf capture-pane -t "$SESSION" -p | tail -n 80 >&2
  exit 1
fi

echo "Next responded ${ready}"
node "$UI_ROOT/scripts/budget-sheet-ui-drive.mjs" "http://127.0.0.1:${PORT}"
