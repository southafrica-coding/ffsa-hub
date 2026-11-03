#!/usr/bin/env bash
# Vercel "Ignored Build Step" for the website (wired up in vercel.json as
# `ignoreCommand`). Vercel's contract: exit 0 = skip this build, exit 1 = build.
#
# We skip ONLY when every changed path is under apps/mobile/ (the phone app,
# which Vercel doesn't deploy). Anything else, including an empty diff, a
# missing base commit, any git failure or any doubt at all, builds the website.
# Every path prints one "vercel-ignore-mobile: ..." line so the build log shows
# which rule decided.
#
# What the changes are compared with (the "base"):
#
#   main, or no branch name (VERCEL_GIT_COMMIT_REF empty): unchanged rule.
#     VERCEL_GIT_PREVIOUS_SHA (the last successful deploy of this branch) when
#     Vercel provides it, so a push of several commits is judged as a whole;
#     otherwise HEAD^.
#
#   any other branch (a PR preview): where the branch left main, so the PR is
#     judged on ALL of its commits, not just the last push. Tried in order:
#       1. a main ref already in the clone (refs/remotes/origin/main, main);
#       2. `git fetch origin main` with a hard time limit and no prompts. On
#          Vercel this usually fails: the clone is shallow and its `origin`
#          has no credentials for this private repo (that is why the earlier
#          fetch-only version never fired and fell back to the last push);
#       3. no network: the newest commit in the clone that GitHub itself made
#          on main (committer noreply@github.com, subject ending "(#123)",
#          i.e. a squash-merged PR) whose parent is also such a commit or is
#          cut off by the shallow clone. Main only changes through squash
#          merges, so that commit is where the branch last met main;
#       4. none of the above: BUILD. Never the old last-push rule on a branch.
#
# Test: scripts/vercel-ignore-mobile.test.sh

set -u

build() { echo "vercel-ignore-mobile: $1 -> building the website"; exit 1; }
skip()  { echo "vercel-ignore-mobile: $1 -> skipping the website build"; exit 0; }

FETCH_TIMEOUT="${VERCEL_IGNORE_FETCH_TIMEOUT:-20}"

# Never let git wait for a password or a host-key prompt.
export GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=5"

# run_with_timeout <seconds> <cmd...>: kills the command if it overruns, so a
# stuck fetch can never hang the build. (No coreutils `timeout` on macOS.)
run_with_timeout() {
  local secs="$1"; shift
  "$@" &
  local pid=$!
  ( sleep "$secs" && kill -TERM "$pid" 2>/dev/null && sleep 2 && kill -KILL "$pid" 2>/dev/null ) >/dev/null 2>&1 &
  local watcher=$!
  wait "$pid"
  local rc=$?
  kill "$watcher" 2>/dev/null
  wait "$watcher" 2>/dev/null
  return "$rc"
}

# A commit GitHub made on main by squash-merging a PR.
is_main_squash() {
  git log -1 --format='%ce %s' "$1" 2>/dev/null | grep -Eq '^noreply@github\.com .* \(#[0-9]+\)$'
}

# Branch fallback 3: newest squash commit reachable from HEAD, checked so a
# lookalike made on the branch (e.g. in GitHub's web editor) can't pass.
squash_base() {
  local c parent
  for c in $(git rev-list --topo-order HEAD 2>/dev/null); do
    is_main_squash "$c" || continue
    parent="$(git rev-parse --verify --quiet "${c}^1" 2>/dev/null)" || parent=""
    if [ -z "$parent" ] || ! git cat-file -e "${parent}^{commit}" 2>/dev/null; then
      echo "$c"; return 0   # parent cut off by the shallow clone
    fi
    if is_main_squash "$parent"; then echo "$c"; return 0; fi
    return 1                # parent looks like a branch commit: unsure
  done
  return 1
}

base=""
ref="${VERCEL_GIT_COMMIT_REF:-}"

if [ -n "$ref" ] && [ "$ref" != "main" ]; then
  git rev-parse --verify --quiet "HEAD^{commit}" >/dev/null || build "branch $ref: no HEAD"

  # 1. main already in the clone
  for m in refs/remotes/origin/main refs/heads/main; do
    sha="$(git rev-parse --verify --quiet "${m}^{commit}" 2>/dev/null)" || continue
    if mb="$(git merge-base HEAD "$sha" 2>/dev/null)" && [ -n "$mb" ]; then
      base="$mb"; how="merge-base with local $m"; break
    fi
  done

  # 2. fetch main (time-limited, best effort)
  if [ -z "$base" ] && git remote get-url origin >/dev/null 2>&1; then
    if run_with_timeout "$FETCH_TIMEOUT" git fetch --no-tags --quiet --depth=200 origin main >/dev/null 2>&1; then
      sha="$(git rev-parse --verify --quiet "FETCH_HEAD^{commit}" 2>/dev/null)" || sha=""
      if [ -n "$sha" ] && [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
        run_with_timeout "$FETCH_TIMEOUT" git fetch --no-tags --quiet --depth=200 origin "refs/heads/$ref" >/dev/null 2>&1 || true
      fi
      if [ -n "$sha" ] && mb="$(git merge-base HEAD "$sha" 2>/dev/null)" && [ -n "$mb" ]; then
        base="$mb"; how="merge-base with fetched origin/main"
      fi
    else
      echo "vercel-ignore-mobile: branch $ref: couldn't fetch main (no access or timed out), using the local history"
    fi
  fi

  # 3. the last squash-merged main commit in the clone
  if [ -z "$base" ] && mb="$(squash_base)" && [ -n "$mb" ]; then
    base="$mb"; how="newest squash-merged main commit in the clone"
  fi

  # 4. unsure
  [ -n "$base" ] || build "branch $ref: couldn't tell where it left main"
  echo "vercel-ignore-mobile: branch $ref, comparing with $base ($how)"
else
  [ -n "$ref" ] || echo "vercel-ignore-mobile: no branch name, using the last deploy rule"
  base="${VERCEL_GIT_PREVIOUS_SHA:-}"
  if [ -n "$base" ]; then
    git cat-file -e "${base}^{commit}" 2>/dev/null || build "previous deploy $base not in clone"
  else
    base="HEAD^"
    git rev-parse --verify --quiet "HEAD^{commit}" >/dev/null || build "no HEAD"
    git rev-parse --verify --quiet "HEAD^^{commit}" >/dev/null || build "HEAD^ unavailable"
  fi
fi

# --no-renames: a file moved out of src/ into apps/mobile/ must still list the
# deleted src/ path. quotepath=off keeps non-ASCII names unquoted (a quoted
# name wouldn't match the prefix anyway, which just means "build").
if ! changed="$(git -c core.quotepath=off diff --no-renames --name-only "$base" HEAD)"; then
  build "git diff failed"
fi

[ -n "$changed" ] || build "empty diff"

while IFS= read -r path; do
  case "$path" in
    apps/mobile/*) ;;
    *) build "web path changed: $path" ;;
  esac
done <<EOF
$changed
EOF

skip "only apps/mobile/ changed"
