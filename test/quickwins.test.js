// «أمس» logging + ladder milestones.
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

const coachH = require('../src/handlers/coach.js');
const weightService = require('../src/services/weight.js');
const { runTick, newMilestones } = require('../src/coachTick.js');

const OWNER = 4242;
let db;
const SET = {
  coach_enabled: true, start_weight: 112, goal_weight: 90, ladder_step: 2, week_start_dow: 0, timezone: 'Asia/Riyadh',
  morning_check_time: '08:00', evening_check_time: '20:00', quiet_start: '23:00', quiet_end: '08:00',
  coach_started_on: '2026-11-01', display_name: 'فيصل', minimum_action: 'مشي ١٥ دقيقة', lifting_days_required: 2,
};
beforeEach(() => {
  fake.reset();
  db = fake.state.db;
  pushed.length = 0;
  db.users.push({ telegram_user_id: OWNER, auth_user_id: 'owner-auth', first_name: 'FaisaL Althuwaini' });
  db.coach_settings.push({ ...fake.SETTINGS_DEFAULTS, ...SET, user_id: OWNER });
});
const ctx = (text) => {
  const replies = [];
  return { from: { id: OWNER, first_name: 'F' }, message: { text }, replies, reply: async (t) => replies.push(t) };
};

test('«أمس ١١١٫٨» and «١١١٫٨ امس» save for yesterday', async () => {
  const S = await import('../shared/stats.mjs');
  const yesterday = S.addDays(weightService.toDateString(new Date()), -1);
  const c = ctx('أمس ١١١٫٨');
  await coachH.handleFreeText(c);
  assert.equal(db.weight_entries.length, 1);
  assert.equal(db.weight_entries[0].recorded_at, yesterday);
  assert.equal(db.weight_entries[0].weight, 111.8);
  assert.match(c.replies[0], /تم ✅ ١١١٫٨ لأمس/);

  const c2 = ctx('111,5 امس');
  await coachH.handleFreeText(c2);
  assert.equal(db.weight_entries.length, 1); // same day → overwritten
  assert.equal(db.weight_entries[0].weight, 111.5);
});

test('«مشيت أمس» / «حديد أمس» mark yesterday', async () => {
  const S = await import('../shared/stats.mjs');
  const yesterday = S.addDays(weightService.toDateString(new Date()), -1);
  await coachH.handleFreeText(ctx('مشيت أمس'));
  await coachH.handleFreeText(ctx('حديد امس'));
  assert.equal(db.daily_checks.length, 1);
  assert.equal(db.daily_checks[0].day, yesterday);
  assert.equal(db.daily_checks[0].minimum_done, true);
  assert.equal(db.daily_checks[0].lifted, true);
});

test('«أمس» is ignored for non-coach users and for non-numbers', async () => {
  db.coach_settings[0].coach_enabled = false;
  const c = ctx('أمس ١١١٫٨');
  await coachH.handleFreeText(c);
  assert.equal(db.weight_entries.length, 0);
  assert.equal(c.replies.length, 0);
  db.coach_settings[0].coach_enabled = true;
  const c2 = ctx('أمس كان زين');
  assert.equal(await coachH.handleYesterday(c2, 'أمس كان زين'), false);
});

test('newMilestones: below start only, not already celebrated, lowest first', () => {
  const snap = { ladder: { reached: [112, 110, 108] } };
  assert.deepEqual(newMilestones(snap, { start_weight: 112 }, new Set()), [108, 110]);
  assert.deepEqual(newMilestones(snap, { start_weight: 112 }, new Set([110])), [108]);
  assert.deepEqual(newMilestones({ ladder: { reached: [112] } }, { start_weight: 112 }, new Set()), []);
});

test('tick: a complete week under 110 → one celebration, friend notified, feed event; not repeated', async () => {
  db.watchers.push({ owner_user_id: OWNER, watcher_auth_user_id: 'friend-auth', display_name: 'سعد' });
  for (const [d, w] of [['2026-11-08', 109.9], ['2026-11-09', 109.7], ['2026-11-10', 109.8], ['2026-11-12', 109.6]]) {
    db.weight_entries.push({ user_id: OWNER, weight: w, recorded_at: d });
  }
  const tg = [];
  const bot = { telegram: { sendMessage: async (id, text) => tg.push(text) } };
  const noon = new Date('2026-11-12T09:00:00Z'); // 12:00 Riyadh
  const out = await runTick(bot, noon);
  const ms = out.filter((o) => o.kind === 'milestone');
  assert.equal(ms.length, 1);
  assert.match(tg[0], /نزلت تحت ١١٠/);
  assert.match(tg[0], /الدرجة الجاية ١٠٨/);
  assert.equal(db.feed_events.length, 1);
  assert.equal(db.feed_events[0].kind, 'milestone');
  assert.ok(pushed.some((p) => p.ids.includes('friend-auth') && /فيصل نزل تحت ١١٠/.test(p.title)));

  await runTick(bot, new Date('2026-11-12T10:00:00Z'));
  assert.equal(tg.filter((t) => /نزلت تحت/.test(t)).length, 1);
});

test('tick: milestone waits out quiet hours', async () => {
  for (const [d, w] of [['2026-11-08', 109.9], ['2026-11-09', 109.7], ['2026-11-10', 109.8]]) {
    db.weight_entries.push({ user_id: OWNER, weight: w, recorded_at: d });
  }
  const tg = [];
  const bot = { telegram: { sendMessage: async (id, text) => tg.push(text) } };
  await runTick(bot, new Date('2026-11-12T21:00:00Z')); // 00:00 Riyadh
  assert.equal(tg.length, 0);
  await runTick(bot, new Date('2026-11-13T06:00:00Z')); // 09:00 Riyadh
  assert.ok(tg.some((t) => /نزلت تحت ١١٠/.test(t)));
});
