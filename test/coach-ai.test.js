// M4: weekly report contract, trend alert, LLM path with one re-ask, template fallback.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fake = require('./helpers/fake-supabase.js');

const pushPath = require.resolve('../src/services/push.js');
require.cache[pushPath] = { id: pushPath, filename: pushPath, loaded: true, exports: { isEnabled: () => true, sendToAuthUsers: async (ids) => ids.length } };
delete process.env.OPENROUTER_API_KEY;
delete process.env.DRY_RUN;

const { runTick } = require('../src/coachTick.js');
const { buildAIReport } = require('../src/coachAI.js');
let C;
beforeEach(async () => { C = C || (await import('../shared/coach.mjs')); });

const OWNER = 4242;
const SET = { coach_enabled: true, start_weight: 112, goal_weight: 90, ladder_step: 2, week_start_dow: 0, timezone: 'Asia/Riyadh',
  morning_check_time: '08:00', evening_check_time: '20:00', quiet_start: '23:00', quiet_end: '08:00', weekly_report_dow: 6, weekly_report_time: '21:00',
  coach_started_on: '2026-10-01', display_name: 'فيصل', minimum_action: 'مشي ١٥ دقيقة', lifting_days_required: 2, target_loss_per_4w: 3 };
function seed(weeks) {
  fake.reset();
  const db = fake.state.db;
  db.users.push({ telegram_user_id: OWNER, auth_user_id: 'owner-auth', first_name: 'FaisaL' });
  db.coach_settings.push({ ...fake.SETTINGS_DEFAULTS, ...SET, user_id: OWNER });
  for (const [ws, w] of weeks) for (let i = 0; i < 4; i++) {
    const d = new Date(Date.parse(ws + 'T12:00:00Z') + i * 86400000).toISOString().slice(0, 10);
    db.weight_entries.push({ user_id: OWNER, weight: w, recorded_at: d });
  }
  return db;
}

test('validateReport enforces the JSON contract', () => {
  const good = { headline: 'أسبوع نازل', went_well: ['نزلت'], watch_out: [], focus_next_week: 'حصتين حديد', tone: 'steady' };
  assert.equal(C.validateReport(good).ok, true);
  assert.equal(C.validateReport({ ...good, tone: 'angry' }).ok, false);
  assert.equal(C.validateReport({ ...good, went_well: [] }).ok, false);
  assert.equal(C.validateReport({ ...good, headline: 'English only' }).ok, false);
  assert.equal(C.validateReport({ ...good, watch_out: ['a', 'b', 'c'].map(() => 'كذا') }).ok, false);
});

test('trendAlert: only two consecutive complete rising weeks (≥ 0.2 each)', () => {
  const wk = (ws, avg, complete = true) => ({ week_start: ws, avg_weight: avg, is_complete: complete, minimum_days: 3, lifting_days: 1 });
  assert.ok(C.trendAlert([wk('2026-10-18', 110), wk('2026-10-25', 110.3), wk('2026-11-01', 110.6)]));
  assert.equal(C.trendAlert([wk('2026-10-18', 110), wk('2026-10-25', 110.1), wk('2026-11-01', 110.6)]), null); // first rise < 0.2
  assert.equal(C.trendAlert([wk('2026-10-18', 110), wk('2026-10-25', 110.3, false), wk('2026-11-01', 110.6)]), null); // incomplete week
  assert.equal(C.trendAlert([wk('2026-10-11', 110), wk('2026-10-25', 110.3), wk('2026-11-01', 110.6)]), null); // gap
});

test('report without a key → template fallback, rendered with his numbers', async () => {
  seed([['2026-11-01', 111.9], ['2026-11-08', 111.4]]);
  const r = await buildAIReport(OWNER, 'current', new Date('2026-11-14T18:05:00Z'));
  assert.equal(r.usedFallback, true);
  assert.match(r.text, /^📊 /);
  assert.match(r.text, /المتوسط: ١١١٫٤ \(−٠٫٥\)/);
  assert.match(r.text, /🎯 الأسبوع الجاي:/);
});

test('report with the LLM: invalid JSON is re-asked once, then accepted', async () => {
  seed([['2026-11-01', 111.9], ['2026-11-08', 111.4]]);
  process.env.OPENROUTER_API_KEY = 'test';
  const real = global.fetch;
  const replies = [
    { headline: 'كذا', went_well: [], focus_next_week: 'x', tone: 'steady' }, // invalid (went_well empty)
    { headline: 'أسبوع نازل يا فيصل', went_well: ['نزلت ٠٫٥'], watch_out: ['الحديد'], focus_next_week: 'حصتين حديد', tone: 'celebrate' },
  ];
  let calls = 0;
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'deepseek/deepseek-v4.1-flash');
    assert.match(body.messages[0].content, /أقل شي يكفي/); // system prompt rules
    if (calls === 1) assert.match(body.messages.at(-1).content, /^Invalid: /);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(replies[calls++]) } }] }) };
  };
  try {
    const r = await buildAIReport(OWNER, 'current', new Date('2026-11-14T18:05:00Z'));
    assert.equal(calls, 2);
    assert.equal(r.usedFallback, false);
    assert.match(r.text, /أسبوع نازل يا فيصل/);
  } finally {
    global.fetch = real;
    delete process.env.OPENROUTER_API_KEY;
  }
});

test('tick sends the weekly report on Saturday 21:00 once, plus a trend alert when due', async () => {
  const db = seed([['2026-10-25', 110.0], ['2026-11-01', 110.3], ['2026-11-08', 110.7]]);
  const tg = [];
  const bot = { telegram: { sendMessage: async (id, t) => tg.push(t) } };
  const sat2105 = new Date('2026-11-14T18:05:00Z'); // Saturday 21:05 Riyadh
  const out = await runTick(bot, sat2105);
  const kinds = out.map((o) => o.kind);
  assert.ok(kinds.includes('weekly_report'));
  assert.ok(kinds.includes('trend_alert'));
  assert.equal(db.coach_messages.filter((m) => m.kind === 'weekly_report').length, 1);
  assert.equal(db.coach_messages.find((m) => m.kind === 'weekly_report').week_start, '2026-11-08');
  assert.ok(db.coach_messages.find((m) => m.kind === 'weekly_report').data.report.headline);

  await runTick(bot, new Date('2026-11-14T18:30:00Z'));
  assert.equal(db.coach_messages.filter((m) => m.kind === 'weekly_report').length, 1); // not again
  assert.equal(db.coach_messages.filter((m) => m.kind === 'trend_alert').length, 1);

  const fri = await runTick(bot, new Date('2026-11-13T18:05:00Z')); // Friday: not the report day
  assert.ok(!fri.some((o) => o.kind === 'weekly_report'));
});
