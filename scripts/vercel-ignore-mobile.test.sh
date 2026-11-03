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

# ── Branch builds: judged against the merge-base with main ─────────────────
# new_origin <name>: a "remote" repo with one web commit on main, cloned to
# $WORK/<name> (so `origin` exists there), then checked out on branch feat.
new_origin() {
  new_repo "$1-origin"
  commit_files base src/app.ts apps/mobile/a.ts
  git clone -q "file://$WORK/$1-origin" "$WORK/$1" && cd "$WORK/$1" || exit 2
  git config user.email test@example.com
  git config user.name test
  git config commit.gpgsign false
  git checkout -q -b feat
}

# 14. branch: a web commit followed by a mobile-only commit -> build
new_origin web-then-mobile
commit_files web src/app.ts
commit_files mobile apps/mobile/a.ts
expect 0 "branch web+mobile, old rule (no ref) only sees the last commit"
expect 1 "branch web then mobile-only -> build" "VERCEL_GIT_COMMIT_REF=feat"
prev="$(git rev-parse HEAD^)"
expect 1 "branch web then mobile-only, previous deploy was the web commit" \
  "VERCEL_GIT_COMMIT_REF=feat" "VERCEL_GIT_PREVIOUS_SHA=$prev"

# 15. branch with only mobile commits -> skip (even after main moves on)
new_origin only-mobile
commit_files m1 apps/mobile/a.ts
commit_files m2 apps/mobile/b.ts
expect 0 "branch with only mobile commits -> skip" "VERCEL_GIT_COMMIT_REF=feat"
(cd "$WORK/only-mobile-origin" && commit_files later-web src/app.ts)
expect 0 "branch only mobile, main has since changed web -> skip" "VERCEL_GIT_COMMIT_REF=feat"

# 16. fetch failure -> falls back to the previous-deploy / HEAD^ rule
new_repo no-origin
commit_files base src/app.ts
git checkout -q -b feat
commit_files web src/app.ts
commit_files mobile apps/mobile/a.ts
expect 0 "no origin: falls back to HEAD^ (mobile only)" "VERCEL_GIT_COMMIT_REF=feat"
prev="$(git rev-parse HEAD~2)"
expect 1 "no origin: falls back to previous sha (spans web)" \
  "VERCEL_GIT_COMMIT_REF=feat" "VERCEL_GIT_PREVIOUS_SHA=$prev"
new_origin bad-remote
commit_files mobile apps/mobile/a.ts
git remote set-url origin "file://$WORK/does-not-exist"
expect 0 "unreachable origin: falls back to HEAD^" "VERCEL_GIT_COMMIT_REF=feat"

# 17. fallback also fails -> build
new_repo no-origin-first
git checkout -q -b feat
commit_files first apps/mobile/a.ts
expect 1 "no origin and no HEAD^ -> build" "VERCEL_GIT_COMMIT_REF=feat"

# 18. main keeps the old rule (previous deploy, else HEAD^), even with origin
new_origin on-main
git checkout -q main
commit_files web src/app.ts
commit_files mobile apps/mobile/a.ts
expect 0 "main: HEAD^ only sees mobile" "VERCEL_GIT_COMMIT_REF=main"
prev="$(git rev-parse HEAD~2)"
expect 1 "main: previous sha spans a web commit" "VERCEL_GIT_COMMIT_REF=main" "VERCEL_GIT_PREVIOUS_SHA=$prev"

# 19. branch identical to main (nothing changed) -> build
new_origin same-as-main
expect 1 "branch with no commits of its own -> build (empty diff)" "VERCEL_GIT_COMMIT_REF=feat"

# 20. shallow clone of the branch (as Vercel does), web commit earlier -> build
new_origin shallow-branch-src
commit_files web src/app.ts
commit_files mobile apps/mobile/a.ts
(cd "$WORK/shallow-branch-src" && git push -q origin feat)
git clone -q --depth 2 --branch feat "file://$WORK/shallow-branch-src-origin" "$WORK/shallow-branch" \
  && cd "$WORK/shallow-branch" || exit 2
expect 1 "shallow branch clone, web commit before a mobile one -> build" "VERCEL_GIT_COMMIT_REF=feat"

echo
echo "$((n - fails))/$n passed (temp repos left in $WORK)"
[ "$fails" = 0 ]
