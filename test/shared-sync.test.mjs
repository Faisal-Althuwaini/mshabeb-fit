import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('edge-function copies of shared/*.mjs are in sync (run scripts/sync-shared.sh)', () => {
  for (const f of ['stats.mjs', 'coach.mjs']) {
    const src = readFileSync(new URL(`../shared/${f}`, import.meta.url), 'utf8');
    const copy = readFileSync(new URL(`../supabase/functions/_shared/${f}`, import.meta.url), 'utf8');
    assert.equal(copy.split('\n').slice(1).join('\n'), src, `${f} drifted`);
  }
});
