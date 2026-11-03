#!/usr/bin/env bash
# Vercel "Ignored Build Step" for the website (wired up in vercel.json as
# `ignoreCommand`). Vercel's contract: exit 0 = skip this build, exit 1 = build.
#
# We skip ONLY when every changed path is under apps/mobile/ (the phone app,
# which Vercel doesn't deploy). Anything else, including an empty diff, a
# missing base commit or any git failure, builds the website as normal.
#
# Base commit:
#   - On a branch other than main (VERCEL_GIT_COMMIT_REF): the merge-base with
#     origin/main, so a PR is judged on ALL of its commits. Otherwise a PR
#     whose last push was mobile-only would skip its preview build even though
#     earlier commits changed the website. Vercel clones are shallow, so main
#     (and, in a shallow clone, the branch itself) is fetched first, depth 200.
#     If that fetch or the merge-base fails, we fall back to the rule below.
#   - On main (or when the branch is unknown, or as the fallback):
#     VERCEL_GIT_PREVIOUS_SHA (the last successful deploy of this branch) when
#     Vercel provides it, so a push of several commits is judged as a whole.
#     Otherwise HEAD^ (e.g. a branch's first deploy).
#
# Test: scripts/vercel-ignore-mobile.test.sh

set -u

build() { echo "vercel-ignore-mobile: $1 -> building the website"; exit 1; }
skip()  { echo "vercel-ignore-mobile: $1 -> skipping the website build"; exit 0; }

base=""
ref="${VERCEL_GIT_COMMIT_REF:-}"
if [ -n "$ref" ] && [ "$ref" != "main" ]; then
  main_sha=""
  if git fetch --no-tags --quiet --depth=200 origin main >/dev/null 2>&1; then
    main_sha="$(git rev-parse --verify --quiet FETCH_HEAD 2>/dev/null)" || main_sha=""
  fi
  # A shallow clone can cut the branch off above its fork point, which would
  # hide the merge-base. Deepen the branch too (best effort).
  if [ -n "$main_sha" ] && [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
    git fetch --no-tags --quiet --depth=200 origin "refs/heads/$ref" >/dev/null 2>&1 || true
  fi
  if [ -n "$main_sha" ] && mb="$(git merge-base HEAD "$main_sha" 2>/dev/null)" && [ -n "$mb" ]; then
    base="$mb"
    echo "vercel-ignore-mobile: branch $ref, comparing with its merge-base with main ($base)"
  else
    echo "vercel-ignore-mobile: branch $ref, couldn't find the merge-base with main; using the last deploy instead"
  fi
fi

if [ -z "$base" ]; then
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
