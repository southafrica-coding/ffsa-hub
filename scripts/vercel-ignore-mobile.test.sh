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

# ── Branch builds (VERCEL_GIT_COMMIT_REF set, not main) ────────────────────
# Main here only changes through GitHub squash merges, like the real repo.
squash() { # squash <msg> <path>...: a commit as GitHub makes it on main
  local msg="$1"; shift
  for f in "$@"; do mkdir -p "$(dirname "$f")"; echo "$RANDOM $msg" >> "$f"; done
  git add -A && GIT_COMMITTER_NAME=GitHub GIT_COMMITTER_EMAIL=noreply@github.com \
    git commit -q -m "$msg (#$RANDOM)"
}
# new_origin <name>: an "origin" repo whose main has two squash-merged PRs
# (both touching the website), cloned in full to $WORK/<name> on branch feat.
new_origin() {
  new_repo "$1-origin"
  squash "pr one" src/app.ts apps/mobile/a.ts
  squash "pr two" src/app.ts
  git clone -q "file://$WORK/$1-origin" "$WORK/$1" && cd "$WORK/$1" || exit 2
  git config user.email test@example.com
  git config user.name test
  git config commit.gpgsign false
  git checkout -q -b feat
}
# vercel_clone <name>: push feat to origin, then clone ONLY feat, shallow
# (depth ${2:-10}) the way Vercel does, and cut off origin so nothing can be
# fetched (a private repo with no credentials in the build container).
vercel_clone() {
  git push -q origin feat 2>/dev/null || exit 2
  git clone -q --depth "${2:-10}" --branch feat "file://$WORK/$1-origin" "$WORK/$1-vercel" \
    && cd "$WORK/$1-vercel" || exit 2
  git remote set-url origin "file://$WORK/no-such-repo"
}
expect_line() { # expect_line <label> <substring> [env...]: the log names the path
  local label="$1" want="$2"; shift 2
  n=$((n + 1))
  local out; out="$(env "$@" bash "$SCRIPT" 2>&1)"
  case "$out" in
    *"$want"*) echo "ok   $label" ;;
    *) echo "FAIL $label: wanted '$want' in: $out"; fails=$((fails + 1)) ;;
  esac
}
B="VERCEL_GIT_COMMIT_REF=feat"

# 14. full clone, origin/main known locally
new_origin local-main
commit_files web src/app.ts
commit_files mobile apps/mobile/a.ts
expect 0 "no ref: old rule only sees the last commit (known gap, main-style)"
expect 1 "branch: web then mobile-only -> build" "$B"
expect 1 "branch: ...even if the previous deploy was the web commit" "$B" "VERCEL_GIT_PREVIOUS_SHA=$(git rev-parse HEAD^)"
expect_line "branch: log names the local main path" "merge-base with local refs/remotes/origin/main" "$B"

new_origin local-mobile
commit_files m1 apps/mobile/a.ts
commit_files m2 apps/mobile/b.ts
expect 0 "branch: only mobile commits -> skip" "$B"
(cd "$WORK/local-mobile-origin" && squash "later web" src/app.ts)
git fetch -q origin
expect 0 "branch: only mobile, main has since changed the website -> skip" "$B"

# 15. Vercel-like: shallow, branch only, origin unreachable
new_origin shallow-web
commit_files web src/app.ts
commit_files m1 apps/mobile/a.ts
commit_files m2 apps/mobile/b.ts
vercel_clone shallow-web
expect 1 "vercel clone: web commit then mobile-only commits -> build" "$B"
expect_line "vercel clone: log names the squash path" "newest squash-merged main commit" "$B"
expect_line "vercel clone: log says the fetch failed" "couldn't fetch main" "$B"

new_origin shallow-mobile
commit_files m1 apps/mobile/a.ts
commit_files m2 apps/mobile/b.ts
vercel_clone shallow-mobile
expect 0 "vercel clone: mobile-only branch -> skip" "$B"

# 16. main merged into the branch (the merge brings web changes from main)
new_origin merged-mobile
commit_files m1 apps/mobile/a.ts
(cd "$WORK/merged-mobile-origin" && squash "web on main" src/app.ts)
git fetch -q origin && git merge -q --no-edit origin/main
commit_files m2 apps/mobile/b.ts
vercel_clone merged-mobile
expect 0 "vercel clone: mobile-only branch with main merged in -> skip" "$B"

new_origin merged-web
commit_files web src/app.ts
(cd "$WORK/merged-web-origin" && squash "web on main" src/other.ts)
git fetch -q origin && git merge -q --no-edit origin/main
commit_files m apps/mobile/b.ts
vercel_clone merged-web
expect 1 "vercel clone: web commit, main merged in, then mobile -> build" "$B"

# 17. branch longer than the clone: no main commit visible -> build
new_origin too-deep
commit_files web src/app.ts
for i in 1 2 3 4; do commit_files "m$i" apps/mobile/a.ts; done
vercel_clone too-deep 3
expect 1 "vercel clone: fork point cut off -> build" "$B"
expect_line "vercel clone: log says it couldn't tell" "couldn't tell where it left main" "$B"

# 18. a lookalike squash commit made ON the branch must not count as main
new_origin lookalike-squash
commit_files web src/app.ts
squash "edited on github" apps/mobile/a.ts
commit_files m apps/mobile/b.ts
vercel_clone lookalike-squash
expect 1 "vercel clone: branch commit that looks like a squash -> build" "$B"

# 19. main with a direct (non-squash) push under the fork point -> build
new_repo direct-origin
squash "pr one" src/app.ts
commit_files "pushed straight to main" src/app.ts
squash "pr two" src/app.ts
git clone -q "file://$WORK/direct-origin" "$WORK/direct" && cd "$WORK/direct" || exit 2
git config user.email test@example.com; git config user.name test; git config commit.gpgsign false
git checkout -q -b feat
commit_files m apps/mobile/a.ts
git push -q origin feat
git clone -q --depth 10 --branch feat "file://$WORK/direct-origin" "$WORK/direct-vercel" && cd "$WORK/direct-vercel" || exit 2
git remote set-url origin "file://$WORK/no-such-repo"
expect 1 "vercel clone: main commit's parent isn't a squash -> build (unsure)" "$B"

# 20. a fetch that hangs is cut off by the time limit
new_origin hang
commit_files m apps/mobile/a.ts
vercel_clone hang
git config protocol.ext.allow always
git remote set-url origin "ext::sleep 60"
start=$(date +%s)
expect 0 "hanging fetch: times out, squash path still skips mobile-only" "$B" "VERCEL_IGNORE_FETCH_TIMEOUT=2"
took=$(( $(date +%s) - start ))
n=$((n + 1))
if [ "$took" -lt 15 ]; then echo "ok   hanging fetch finished in ${took}s"
else echo "FAIL hanging fetch took ${took}s"; fails=$((fails + 1)); fi

# 21. no origin remote at all, not shallow, no main ref, no squash -> build
new_repo no-origin
commit_files base src/app.ts
git checkout -q -b feat
git branch -q -D main
commit_files m apps/mobile/a.ts
expect 1 "no origin, no main, no squash commits -> build" "$B"

# 22. branch with no commits of its own -> build (empty diff)
new_origin same-as-main
vercel_clone same-as-main
expect 1 "branch identical to main -> build" "$B"

# 23. main keeps the old rule (previous deploy, else HEAD^)
new_origin on-main
git checkout -q main
commit_files web src/app.ts
commit_files mobile apps/mobile/a.ts
expect 0 "main: HEAD^ only sees mobile (unchanged)" "VERCEL_GIT_COMMIT_REF=main"
prev="$(git rev-parse HEAD~2)"
expect 1 "main: previous sha spans a web commit (unchanged)" "VERCEL_GIT_COMMIT_REF=main" "VERCEL_GIT_PREVIOUS_SHA=$prev"

echo
echo "$((n - fails))/$n passed (temp repos left in $WORK)"
[ "$fails" = 0 ]
