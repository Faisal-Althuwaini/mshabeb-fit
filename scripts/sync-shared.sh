#!/bin/sh
# Copy the one shared implementation into the edge-functions tree (Supabase bundles only
# files under supabase/functions). test/shared-sync.test.mjs fails if the copies drift.
set -e
cd "$(dirname "$0")/.."
for f in stats.mjs coach.mjs; do
  { echo "// GENERATED from shared/$f by scripts/sync-shared.sh. Do not edit here."; cat "shared/$f"; } > "supabase/functions/_shared/$f"
done
echo "synced shared/*.mjs → supabase/functions/_shared/"
