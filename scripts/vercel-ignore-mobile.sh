#!/usr/bin/env bash
# Vercel "Ignored Build Step" for the website (wired up in vercel.json as
# `ignoreCommand`). Vercel's contract: exit 0 = skip this build, exit 1 = build.
#
# We skip ONLY when every changed path is under apps/mobile/ (the phone app,
# which Vercel doesn't deploy). Anything else, including an empty diff, a
# missing base commit or any git failure, builds the website as normal.
#
# Base commit: VERCEL_GIT_PREVIOUS_SHA (the last successful deploy of this
# branch) when Vercel provides it, so a push of several commits is judged as a
# whole. Otherwise HEAD^ (e.g. a branch's first deploy).
#
# Test: scripts/vercel-ignore-mobile.test.sh

set -u

build() { echo "vercel-ignore-mobile: $1 -> building the website"; exit 1; }
skip()  { echo "vercel-ignore-mobile: $1 -> skipping the website build"; exit 0; }

base="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -n "$base" ]; then
  git cat-file -e "${base}^{commit}" 2>/dev/null || build "previous deploy $base not in clone"
else
  base="HEAD^"
  git rev-parse --verify --quiet "HEAD^{commit}" >/dev/null || build "no HEAD"
  git rev-parse --verify --quiet "HEAD^^{commit}" >/dev/null || build "HEAD^ unavailable"
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
