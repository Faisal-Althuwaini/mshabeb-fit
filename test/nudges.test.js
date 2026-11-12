// M3: nudge rules (pure) + the tick end-to-end against the fake Supabase.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fake = require('./helpers/fake-supabase.js');

const pushed = [];
const pushPath = require.resolve('../src/services/push.js');
require.cache[pushPath] = {
  id: pushPath, filename: pushPath, loaded: true,
  exports: { isEnabled: () => true, sendToAuthUsers: async (ids, p) => { pushed.push({ ids, ...p }); return ids.length; } },
};
delete process.env.DEEPSEEK_API_KEY;
delete process.env.DRY_RUN;

const { decideNudges, renderTemplate, inQuietHours, TEMPLATES } = require('../src/nudges.js');
const { runTick } = require('../src/coachTick.js');

let S;
const SETTINGS = {
  coach_enabled: true, start_weight: 112, goal_weight: 90, ladder_step: 2, minimum_action: 'مشي ١٥ دقيقة',
  lifting_days_required: 2, week_start_dow: 0, timezone: 'Asia/Riyadh', morning_check_time: '08:00:00',
  evening_check_time: '20:00:00', quiet_start: '23:00:00', quiet_end: '08:00:00', paused_until: null,
};
const snap = (o = {}) => ({
  today: '2026-11-12', todayWeight: null, missedDays: 0, streak: 3, bestStreak: 19, totalLost: 1.3,
  thisWeek: { lifting_days: 0, avg_weight: 111.6 }, lastWeek: { avg_weight: 112.1 }, ladder: { next: 110 }, ...o,
});
const decide = (o) => decideNudges({ settings: SETTINGS, snapshot: snap(), nowMin: 9 * 60, dow: 4, sentToday: [], lastComebackDate: null, daysBetween: S.daysBetween, ...o });

beforeEach(async () => { S = S || (await import('../shared/stats.mjs')); });

test('quiet hours wrap midnight', () => {
  assert.equal(inQuietHours(23 * 60 + 30, '23:00', '08:00'), true);
  assert.equal(inQuietHours(7 * 60 + 59, '23:00', '08:00'), true);
  assert.equal(inQuietHours(8 * 60, '23:00', '08:00'), false);
  assert.equal(inQuietHours(14 * 60, '23:00', '08:00'), false);
});

test('morning: only if no weigh-in today, only inside its window', () => {
  assert.deepEqual(decide({ nowMin: 8 * 60 + 5 }), ['nudge_morning']);
  assert.deepEqual(decide({ nowMin: 8 * 60 + 5, snapshot: snap({ todayWeight: 111.2 }) }), []);
  assert.deepEqual(decide({ nowMin: 7 * 60 }), []); // before its time (and quiet)
  assert.deepEqual(decide({ nowMin: 12 * 60 }), []); // window over (3h)
  assert.deepEqual(decide({ nowMin: 8 * 60 + 5, sentToday: ['nudge_morning'] }), []); // already sent
});

test('firm "don\'t skip twice": yesterday AND today inactive (missedDays = 2)', () => {
  assert.deepEqual(decide({ nowMin: 20 * 60, dow: 2, snapshot: snap({ missedDays: 2, todayWeight: null }) }), ['nudge_firm']);
  assert.deepEqual(decide({ nowMin: 20 * 60, dow: 2, snapshot: snap({ missedDays: 1 }) }), []); // only yesterday missed: fine
  assert.deepEqual(decide({ nowMin: 20 * 60, dow: 2, snapshot: snap({ missedDays: 0 }) }), []);
});

test('comeback after 3+ days, at most once every 3 days', () => {
  const s3 = snap({ missedDays: 4 });
  assert.deepEqual(decide({ nowMin: 20 * 60, dow: 2, snapshot: s3 }), ['comeback']);
  assert.deepEqual(decide({ nowMin: 20 * 60, dow: 2, snapshot: s3, lastComebackDate: '2026-11-10' }), []); // 2 days ago
  assert.deepEqual(decide({ nowMin: 20 * 60, dow: 2, snapshot: s3, lastComebackDate: '2026-11-09' }), ['comeback']); // 3 days ago
});

test('Thursday lifting check only when behind', () => {
  assert.deepEqual(decide({ nowMin: 20 * 60, dow: 4, snapshot: snap({ thisWeek: { lifting_days: 1 } }) }), ['lifting_check']);
  assert.deepEqual(decide({ nowMin: 20 * 60, dow: 4, snapshot: snap({ thisWeek: { lifting_days: 2 } }) }), []);
  assert.deepEqual(decide({ nowMin: 20 * 60, dow: 3, snapshot: snap({ thisWeek: { lifting_days: 0 } }) }), []);
});

test('max 2 nudges a day, priority order, pause and quiet hours', () => {
  const busy = snap({ missedDays: 2, thisWeek: { lifting_days: 0 } });
  // evening Thursday: firm + lifting both due
  assert.deepEqual(decide({ nowMin: 20 * 60, dow: 4, snapshot: busy }), ['nudge_firm', 'lifting_check']);
  // morning already used one → only one more allowed
  assert.deepEqual(decide({ nowMin: 20 * 60, dow: 4, snapshot: busy, sentToday: ['nudge_morning'] }), ['nudge_firm']);
  assert.deepEqual(decide({ nowMin: 20 * 60, dow: 4, snapshot: busy, sentToday: ['nudge_morning', 'nudge_firm'] }), []);
  // weekly report / chat don't count towards the cap
  assert.deepEqual(decide({ nowMin: 20 * 60, dow: 4, snapshot: busy, sentToday: ['weekly_report', 'chat_coach'] }).length, 2);
  // paused
  assert.deepEqual(decide({ nowMin: 20 * 60, dow: 4, snapshot: busy, settings: { ...SETTINGS, paused_until: '2026-11-15' } }), []);
  // quiet hours (evening time set inside quiet)
  assert.deepEqual(decide({ nowMin: 23 * 60 + 10, dow: 4, snapshot: busy, settings: { ...SETTINGS, evening_check_time: '23:00' } }), []);
  // coach off
  assert.deepEqual(decide({ nowMin: 8 * 60 + 5, settings: { ...SETTINGS, coach_enabled: false } }), []);
});

test('templates render with his numbers and no leftover placeholders', () => {
  for (const kind of Object.keys(TEMPLATES)) {
    for (let d = 0; d < TEMPLATES[kind].length; d++) {
      const t = renderTemplate(kind, { S, snapshot: snap({ thisWeek: { lifting_days: 1 } }), settings: SETTINGS, name: 'فيصل', dayIndex: d });
      assert.ok(!/[{}]/.test(t), t);
      assert.ok(t.length > 10);
    }
  }
  const c = renderTemplate('comeback', { S, snapshot: snap(), settings: SETTINGS, name: 'فيصل', dayIndex: 0 });
  assert.match(c, /نازل ١٫٣ كيلو/);
  assert.match(c, /مشي ١٥ دقيقة/);
});

// ── Tick end-to-end ───────────────────────────────────────────────────────

const OWNER = 4242;
function seed() {
  fake.reset();
  const db = fake.state.db;
  db.users.push({ telegram_user_id: OWNER, auth_user_id: 'owner-auth', first_name: 'FaisaL Althuwaini' });
  db.coach_settings.push({ ...fake.SETTINGS_DEFAULTS, ...SETTINGS, user_id: OWNER, display_name: 'فيصل', coach_started_on: '2026-11-01' });
  db.weight_entries.push({ user_id: OWNER, weight: 111.6, recorded_at: '2026-11-09' });
  return db;
}
const fakeBot = (log) => ({ telegram: { sendMessage: async (id, text) => log.push({ id, text }) } });

test('tick: morning nudge goes to Telegram + push, is logged, and is not sent twice', async () => {
  const db = seed();
  const tg = [];
  pushed.length = 0;
  const morning = new Date('2026-11-12T05:10:00Z'); // 08:10 Riyadh, no weigh-in today
  const out = await runTick(fakeBot(tg), morning);
  assert.deepEqual(out.map((x) => x.kind), ['nudge_morning']);
  assert.equal(tg.length, 1);
  assert.equal(pushed.length, 1);
  assert.deepEqual(pushed[0].ids, ['owner-auth']);
  assert.equal(db.coach_messages.length, 1);
  assert.equal(db.coach_messages[0].local_date, '2026-11-12');
  assert.deepEqual(db.coach_messages[0].channels, ['telegram', 'push']);
  assert.equal(db.coach_messages[0].used_fallback, true);

  await runTick(fakeBot(tg), new Date('2026-11-12T05:30:00Z'));
  assert.equal(tg.length, 1); // idempotent
});

test('tick: firm in the evening after a missed day; DRY_RUN sends nothing', async () => {
  const db = seed(); // last active 11-09 → on 11-11 missedDays = 2
  const tg = [];
  process.env.DRY_RUN = '1';
  try {
    const out = await runTick(fakeBot(tg), new Date('2026-11-11T17:05:00Z')); // 20:05 Riyadh
    assert.deepEqual(out.map((x) => x.kind), ['nudge_firm']);
    assert.equal(tg.length, 0);
    assert.equal(db.coach_messages.length, 0);
  } finally {
    delete process.env.DRY_RUN;
  }
  const out2 = await runTick(fakeBot(tg), new Date('2026-11-11T17:05:00Z'));
  assert.deepEqual(out2.map((x) => x.kind), ['nudge_firm']);
  assert.match(tg[0].text, /مشي ١٥ دقيقة|لا تغيب|اليوم/);
});

test('tick: DeepSeek down → template fallback, still delivered', async () => {
  seed();
  process.env.DEEPSEEK_API_KEY = 'test';
  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error('network down'); };
  const tg = [];
  try {
    const out = await runTick(fakeBot(tg), new Date('2026-11-12T05:10:00Z'));
    assert.equal(out.length, 1);
    assert.equal(fake.state.db.coach_messages[0].used_fallback, true);
    assert.equal(tg.length, 1);
  } finally {
    global.fetch = realFetch;
    delete process.env.DEEPSEEK_API_KEY;
  }
});
