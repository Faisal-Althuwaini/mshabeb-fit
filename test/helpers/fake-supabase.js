// In-memory fake of the parts of supabase-js the bot uses. Installs itself as src/supabase.js.
const path = require('path');

process.env.BOT_TOKEN = process.env.BOT_TOKEN || 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test';

const PK = {
  users: ['telegram_user_id'],
  weight_entries: ['user_id', 'recorded_at'],
  coach_settings: ['user_id'],
  daily_checks: ['user_id', 'day'],
  coach_messages: ['id'],
  link_codes: ['code'],
  watchers: ['owner_user_id', 'watcher_auth_user_id'],
  meal_posts: ['id'],
  flex_photos: ['id'],
  feed_events: ['owner_user_id', 'kind', 'gap_key'],
  feed_reactions: ['owner_user_id', 'item_kind', 'item_ref', 'author_auth_user_id'],
  feed_comments: ['id'],
  push_subscriptions: ['id'],
  flex_posts: ['id'],
  body_measurements: ['user_id', 'day'],
};
const AUTO_ID = new Set(['coach_messages', 'meal_posts', 'flex_photos', 'feed_comments', 'push_subscriptions', 'feed_events', 'flex_posts']);
const SETTINGS_DEFAULTS = {
  coach_enabled: false, start_weight: null, goal_weight: null, target_loss_per_4w: 3, ladder_step: 2,
  minimum_action: 'مشي ١٥ دقيقة', lifting_days_required: 2, week_start_dow: 0,
  timezone: 'Asia/Riyadh', paused_until: null, quiet_start: '23:00', quiet_end: '08:00',
};

const state = { db: null, storage: null };
function reset() {
  state.db = Object.fromEntries(Object.keys(PK).map((k) => [k, []]));
  state.storage = {};
}
reset();

function query(table) {
  const filters = [];
  let op = 'select';
  let payload = null;
  let opts = {};
  let single = null;
  let order = null;
  let limit = null;
  let wantRows = false;
  const q = {
    select() { if (op !== 'select') wantRows = true; return q; },
    eq(c, v) { filters.push((r) => String(r[c]) === String(v)); return q; },
    neq(c, v) { filters.push((r) => String(r[c]) !== String(v)); return q; },
    gte(c, v) { filters.push((r) => r[c] >= v); return q; },
    lte(c, v) { filters.push((r) => r[c] <= v); return q; },
    lt(c, v) { filters.push((r) => r[c] < v); return q; },
    in(c, vs) { const s = new Set(vs.map(String)); filters.push((r) => s.has(String(r[c]))); return q; },
    is(c, v) { filters.push((r) => (r[c] ?? null) === v); return q; },
    not() { return q; },
    order(c, { ascending = true } = {}) { order = { c, ascending }; return q; },
    limit(n) { limit = n; return q; },
    maybeSingle() { single = 'maybe'; return q; },
    single() { single = 'one'; return q; },
    insert(row) { op = 'insert'; payload = row; return q; },
    upsert(row, o = {}) { op = 'upsert'; payload = row; opts = o; return q; },
    update(row) { op = 'update'; payload = row; return q; },
    delete() { op = 'delete'; return q; },
    then(resolve, reject) { try { resolve(run()); } catch (e) { reject(e); } },
  };
  const match = (r) => filters.every((f) => f(r));
  function run() {
    const rows = state.db[table];
    let out;
    if (op === 'insert' || op === 'upsert') {
      const keys = PK[table];
      const list = Array.isArray(payload) ? payload : [payload];
      out = [];
      for (const p of list) {
        let row = { ...p };
        if (table === 'coach_settings') row = { ...SETTINGS_DEFAULTS, ...row };
        if (AUTO_ID.has(table) && row.id == null) row.id = rows.length + 1;
        const idx = rows.findIndex((r) => keys.every((k) => String(r[k]) === String(row[k])));
        if (idx >= 0 && op === 'upsert') {
          if (opts.ignoreDuplicates) continue;
          rows[idx] = { ...rows[idx], ...row };
          out.push(rows[idx]);
        } else if (idx < 0) {
          rows.push(row);
          out.push(row);
        } else {
          return { data: null, error: { message: 'duplicate key' } };
        }
      }
    } else if (op === 'update') {
      out = rows.filter(match);
      out.forEach((r) => Object.assign(r, payload));
    } else if (op === 'delete') {
      state.db[table] = rows.filter((r) => !match(r));
      out = [];
    } else {
      out = rows.filter(match).map((r) => ({ ...r }));
      if (order) out.sort((a, b) => (a[order.c] < b[order.c] ? -1 : 1) * (order.ascending ? 1 : -1));
      if (limit != null) out = out.slice(0, limit);
    }
    if (op !== 'select' && !wantRows && !single) return { data: null, error: null };
    if (single) {
      if (out.length === 0) return single === 'one' ? { data: null, error: { message: 'no rows' } } : { data: null, error: null };
      return { data: out[0], error: null };
    }
    return { data: out, error: null };
  }
  return q;
}

const fakeClient = {
  from: query,
  storage: {
    from(bucket) {
      return {
        async upload(p, body, o) {
          state.storage[`${bucket}/${p}`] = { size: body.length, contentType: o?.contentType };
          return { data: { path: p }, error: null };
        },
      };
    },
  },
};

require.cache[path.resolve(__dirname, '../../src/supabase.js')] = {
  id: 'fake', filename: 'fake', loaded: true,
  exports: { getSupabase: () => fakeClient },
};

module.exports = { state, reset, SETTINGS_DEFAULTS, db: () => state.db };
