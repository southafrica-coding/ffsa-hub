#!/bin/sh
# Copies the web app's Supabase types (src/types/database.ts at the repo root,
# the source of truth) into the mobile app, with a "generated copy" header.
#
#   npm run types:sync    write/refresh src/types/database.ts
#   npm run types:check   exit 1 if the copy is stale (used in CI)
#
# Never edit apps/mobile/src/types/database.ts by hand.

set -eu

here="$(cd "$(dirname "$0")/.." && pwd)"
source_file="$here/../../src/types/database.ts"
target_file="$here/src/types/database.ts"

if [ ! -f "$source_file" ]; then
  echo "types: source not found: $source_file (run from a full checkout of the repo)" >&2
  exit 1
fi

expected="$(mktemp)"
trap 'rm -f "$expected"' EXIT
{
  echo "// GENERATED COPY - do not edit; run npm run types:sync"
  echo "// Source: src/types/database.ts at the repo root (the web app's Supabase types)."
  echo
  cat "$source_file"
} > "$expected"

if [ "${1:-}" = "--check" ]; then
  if [ -f "$target_file" ] && cmp -s "$expected" "$target_file"; then
    echo "types: apps/mobile/src/types/database.ts is up to date"
    exit 0
  fi
  echo "types: apps/mobile/src/types/database.ts is stale. Run: cd apps/mobile && npm run types:sync" >&2
  exit 1
fi

mkdir -p "$(dirname "$target_file")"
cp "$expected" "$target_file"
echo "types: copied src/types/database.ts -> apps/mobile/src/types/database.ts"
