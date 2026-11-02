#!/usr/bin/env bash
# Tests for scripts/vercel-ignore-mobile.sh, run against throwaway git repos in
# a temp directory (the real repo is never touched).
#   bash scripts/vercel-ignore-mobile.test.sh
# Expect: exit 0 = skip the website build, exit 1 = build it.

set -u
SCRIPT="$(cd "$(dirname "$0")" && pwd)/vercel-ignore-mobile.sh"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/vercel-ignore-test.XXXXXX")"
fails=0
n=0

new_repo() {
  local dir="$WORK/$1"
  mkdir -p "$dir" && cd "$dir" || exit 2
  git init -q -b main
  git config user.email test@example.com
  git config user.name test
  git config commit.gpgsign false
}

commit_files() { # commit_files <msg> <path>...
  local msg="$1"; shift
  for f in "$@"; do mkdir -p "$(dirname "$f")"; echo "$RANDOM $msg" >> "$f"; done
  git add -A && git commit -q -m "$msg"
}

expect() { # expect <code> <label> [env assignments...]
  local want="$1" label="$2"; shift 2
  n=$((n + 1))
  env "$@" bash "$SCRIPT" >/dev/null 2>&1
  local got=$?
  if [ "$got" = "$want" ]; then echo "ok   $label (exit $got)"
  else echo "FAIL $label: want $want, got $got"; fails=$((fails + 1)); fi
}

# 1. mobile-only commit -> skip
new_repo mobile-only
commit_files base src/app.ts
commit_files mobile apps/mobile/app/index.tsx apps/mobile/README.md
expect 0 "only apps/mobile changed"

# 2. web-only commit -> build
new_repo web-only
commit_files base src/app.ts
commit_files web src/app.ts
expect 1 "only web changed"

# 3. mixed commit -> build
new_repo mixed
commit_files base src/app.ts
commit_files mixed src/app.ts apps/mobile/app/index.tsx
expect 1 "web + mobile changed"

# 4. root config touched alongside mobile -> build
new_repo root-config
commit_files base vercel.json
commit_files cfg vercel.json apps/mobile/package.json
expect 1 "vercel.json + mobile changed"

# 5. lookalike prefixes are not mobile -> build
new_repo lookalike
commit_files base src/app.ts
commit_files look apps/mobile-web/x.ts apps/mobilex/y.ts
expect 1 "apps/mobile-web, apps/mobilex"
new_repo apps-other
commit_files base src/app.ts
commit_files other apps/other/x.ts
expect 1 "apps/other"

# 6. single root commit (no HEAD^) -> build
new_repo first-commit
commit_files first apps/mobile/a.ts
expect 1 "no HEAD^ (first commit)"

# 7. empty commit -> build
new_repo empty
commit_files base apps/mobile/a.ts
git commit -q --allow-empty -m empty
expect 1 "empty diff"

# 8. file moved from src/ into apps/mobile/ -> build (deleted web path counts)
new_repo rename
commit_files base src/shared.ts
mkdir -p apps/mobile && git mv src/shared.ts apps/mobile/shared.ts && git commit -q -m move
expect 1 "rename src/ -> apps/mobile/"

# 9. deletion of a web file -> build
new_repo delete
commit_files base src/a.ts src/b.ts
git rm -q src/b.ts && git commit -q -m del
expect 1 "web file deleted"

# 10. multi-commit push judged from VERCEL_GIT_PREVIOUS_SHA
new_repo previous-sha
commit_files base src/app.ts
prev="$(git rev-parse HEAD)"
commit_files web src/app.ts
commit_files mobile apps/mobile/a.ts
expect 0 "HEAD^ only sees mobile (no previous sha)"
expect 1 "previous sha spans a web commit" "VERCEL_GIT_PREVIOUS_SHA=$prev"
mob_prev="$(git rev-parse HEAD^)"
expect 0 "previous sha spans only mobile" "VERCEL_GIT_PREVIOUS_SHA=$mob_prev"

# 11. previous sha not in the clone -> build
expect 1 "previous sha unknown" "VERCEL_GIT_PREVIOUS_SHA=0123456789abcdef0123456789abcdef01234567"

# 12. not a git repo -> build
mkdir -p "$WORK/not-git" && cd "$WORK/not-git" || exit 2
expect 1 "not a git repository" "GIT_CEILING_DIRECTORIES=$WORK"

# 13. shallow clone with depth 1 (HEAD^ missing) -> build
new_repo shallow-src
commit_files base src/app.ts
commit_files mobile apps/mobile/a.ts
git clone -q --depth 1 "file://$WORK/shallow-src" "$WORK/shallow" && cd "$WORK/shallow" || exit 2
expect 1 "shallow clone, HEAD^ missing"

echo
echo "$((n - fails))/$n passed (temp repos left in $WORK)"
[ "$fails" = 0 ]
