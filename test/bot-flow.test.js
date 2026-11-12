// End-to-end handler tests against an in-memory fake of the Supabase client.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

delete process.env.DEEPSEEK_API_KEY;
const fake = require('./helpers/fake-supabase.js');
const { SETTINGS_DEFAULTS } = fake;
// `db` is reassigned on every reset, so read it through a getter.
let db;
function resetDb() { fake.reset(); db = fake.state.db; }

const weightH = require('../src/handlers/weight.js');
const coachH = require('../src/handlers/coach.js');
const weightService = require('../src/services/weight.js');
const coach = require('../src/services/coach.js');

const USER = 4242;
function ctx(text, extra = {}) {
  const replies = [];
  return {
    from: { id: USER, first_name: 'F' },
    message: { text },
    replies,
    reply: async (t, markup) => { replies.push({ text: t, markup }); },
    answerCbQuery: async () => {},
    editMessageReplyMarkup: async () => {},
    ...extra,
  };
}

beforeEach(resetDb);

/** Opt the test user in to the coach (as if they sent /coach 80 112). */
function enableCoach() {
  if (!db.users.find((u) => u.telegram_user_id === USER)) db.users.push({ telegram_user_id: USER });
  db.coach_settings.push({ ...SETTINGS_DEFAULTS, user_id: USER, coach_enabled: true, start_weight: 112, goal_weight: 80 });
}

test('Arabic digits save 112.4 and reply with weekly average + streak', async () => {
  enableCoach();
  const c = ctx('١١٢٫٤');
  await weightH.handlePlainNumber(c);
  const today = weightService.toDateString(new Date());
  assert.equal(db.weight_entries.length, 1);
  assert.equal(db.weight_entries[0].weight, 112.4);
  assert.equal(db.weight_entries[0].recorded_at, today);
  assert.equal(db.weight_entries[0].source, 'telegram');
  const reply = c.replies.at(-1).text;
  assert.match(reply, /تم ✅ ١١٢٫٤/);
  assert.match(reply, /متوسط الأسبوع لين الحين: ١١٢٫٤/);
  assert.match(reply, /سلسلتك: يوم واحد 🔥/);
});

test('out-of-range weight is rejected', async () => {
  enableCoach();
  const c = ctx('300');
  await weightH.handlePlainNumber(c);
  assert.equal(db.weight_entries.length, 0);
  assert.match(c.replies[0].text, /لازم يكون بين/);
});

test('a >3 kg jump asks for confirmation, confirm saves it', async () => {
  enableCoach();
  db.users.push({ telegram_user_id: USER });
  db.weight_entries.push({ user_id: USER, weight: 112, recorded_at: '2020-01-01' });
  const c = ctx('116');
  await weightH.handlePlainNumber(c);
  assert.equal(db.weight_entries.length, 1);
  assert.match(c.replies[0].text, /متأكد/);

  const cb = ctx(undefined, { match: ['wconfirm:116', '116'] });
  await weightH.handleWeightConfirm(cb);
  assert.equal(db.weight_entries.length, 2);
  assert.match(cb.replies.at(-1).text, /تم ✅ ١١٦/);
});

test('/done and مشيت mark minimum; /gym marks lifting with label', async () => {
  await coachH.handleDone(ctx('/done'));
  const c = ctx('حديد');
  await coachH.handleFreeText(c);
  const g = ctx('/gym posterior');
  await coachH.handleGym(g);
  assert.equal(db.daily_checks.length, 1);
  const row = db.daily_checks[0];
  assert.equal(row.minimum_done, true);
  assert.equal(row.lifted, true);
  assert.equal(row.workout_label, 'posterior');
  assert.match(g.replies[0].text, /خلفي/);
  assert.match(g.replies[0].text, /حديد هالأسبوع: ١\/٢/);
});

test('/pause sets paused_until, /resume clears it', async () => {
  const c = ctx('/pause ٥');
  await coachH.handlePause(c);
  const s = db.coach_settings[0];
  const today = weightService.toDateString(new Date());
  const S = await import('../shared/stats.mjs');
  assert.equal(s.paused_until, S.addDays(today, 4));
  assert.equal(await coach.isPaused(USER), true);
  await coachH.handleResume(ctx('/resume'));
  assert.equal(db.coach_settings[0].paused_until, null);
  assert.equal(await coach.isPaused(USER), false);
});

test('/link consumes a valid code and sets auth_user_id', async () => {
  enableCoach();
  db.link_codes.push({ code: '123456', auth_user_id: 'auth-uuid', expires_at: new Date(Date.now() + 60000).toISOString() });
  const c = ctx('/link ١٢٣٤٥٦');
  await coachH.handleLink(c);
  assert.equal(db.users[0].auth_user_id, 'auth-uuid');
  assert.equal(db.link_codes.length, 0);
  assert.match(c.replies[0].text, /تم الربط/);

  db.link_codes.push({ code: '654321', auth_user_id: 'x', expires_at: new Date(Date.now() - 1000).toISOString() });
  const c2 = ctx('/link 654321');
  await coachH.handleLink(c2);
  assert.match(c2.replies[0].text, /انتهى/);
});

test('/report renders the template report', async () => {
  enableCoach();
  db.users.push({ telegram_user_id: USER });
  const S = await import('../shared/stats.mjs');
  const today = weightService.toDateString(new Date());
  db.weight_entries.push({ user_id: USER, weight: 112.4, recorded_at: today });
  const c = ctx('/report');
  await coachH.handleReport(c);
  const t = c.replies[0].text;
  assert.match(t, /ملخص الأسبوع/);
  assert.match(t, /المتوسط: ١١٢٫٤/);
  assert.match(t, /الحديد: ٠\/٢/);
  assert.ok(S);
});

test('free text without DeepSeek key is ignored (previous behaviour)', async () => {
  const c = ctx('شلونك');
  await coachH.handleFreeText(c);
  assert.equal(c.replies.length, 0);
});

test('free text via DeepSeek: "112.4 وحديد وأكلت برا" saves all three', async () => {
  enableCoach();
  process.env.DEEPSEEK_API_KEY = 'test';
  const realFetch = global.fetch;
  let sentBody;
  global.fetch = async (url, init) => {
    sentBody = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          weight: 112.4, minimum_done: null, lifted: true, workout_label: null,
          ate_out: true, confident: true, question: null,
        }) } }],
      }),
    };
  };
  try {
    const c = ctx('112.4 وحديد وأكلت برا');
    await coachH.handleFreeText(c);
    assert.equal(sentBody.model, 'deepseek-flash');
    assert.equal(db.weight_entries[0].weight, 112.4);
    assert.equal(db.daily_checks[0].lifted, true);
    assert.equal(db.daily_checks[0].ate_out, true);
    assert.match(c.replies.at(-1).text, /تم ✅ ١١٢٫٤/);
    assert.match(c.replies.at(-1).text, /حديد 🏋️/);
  } finally {
    global.fetch = realFetch;
    delete process.env.DEEPSEEK_API_KEY;
  }
});

test('free text via DeepSeek: unsure → asks, saves nothing; API down → friendly fallback', async () => {
  enableCoach();
  process.env.DEEPSEEK_API_KEY = 'test';
  const realFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '{"weight":null,"minimum_done":null,"lifted":true,"workout_label":null,"ate_out":null,"confident":false,"question":"تقصد تمرنت اليوم؟"}' } }] }),
  });
  try {
    const c = ctx('أمس حديد');
    await coachH.handleFreeText(c);
    assert.equal(db.daily_checks.length, 0);
    assert.equal(c.replies[0].text, 'تقصد تمرنت اليوم؟');

    global.fetch = async () => { throw new Error('network down'); };
    const c2 = ctx('مشيت ربع ساعة اليوم');
    await coachH.handleFreeText(c2);
    assert.match(c2.replies[0].text, /ما قدرت أفهمها/);
  } finally {
    global.fetch = realFetch;
    delete process.env.DEEPSEEK_API_KEY;
  }
});

// ── Non-coach users keep the original bot (DECISIONS.md D12) ───────────────

test('non-coach: original reply text, original 20–300 range, Arabic digits accepted', async () => {
  const c = ctx('١١٢٫٤');
  await weightH.handlePlainNumber(c);
  const today = weightService.toDateString(new Date());
  assert.equal(db.weight_entries[0].weight, 112.4);
  assert.match(c.replies[0].text, new RegExp(`^تم الحفظ: 112.4 كغ لليوم ${today}\\.`));

  const c2 = ctx('25'); // valid in the original bot, rejected for coach users
  await weightH.handlePlainNumber(c2);
  assert.equal(db.weight_entries.length, 1); // same day → upsert
  assert.equal(db.weight_entries[0].weight, 25);

  const c3 = ctx('400'); // out of range: original bot silently ignored it
  await weightH.handlePlainNumber(c3);
  assert.equal(c3.replies.length, 0);
});

test('non-coach: no jump confirmation', async () => {
  db.users.push({ telegram_user_id: USER });
  db.weight_entries.push({ user_id: USER, weight: 90, recorded_at: '2020-01-01' });
  const c = ctx('100');
  await weightH.handlePlainNumber(c);
  assert.match(c.replies[0].text, /^تم الحفظ/);
});

test('non-coach: /report gives the original summary; /link and DeepSeek are off', async () => {
  db.users.push({ telegram_user_id: USER });
  db.weight_entries.push({ user_id: USER, weight: 90, recorded_at: weightService.toDateString(new Date()) });
  const r = ctx('/report');
  await coachH.handleReport(r);
  assert.match(r.replies[0].text, /ملخص أسبوعك/);

  const l = ctx('/link 123456');
  await coachH.handleLink(l);
  assert.match(l.replies[0].text, /فعّله أول/);

  process.env.DEEPSEEK_API_KEY = 'test';
  const realFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error('should not be called'); };
  try {
    const f = ctx('112.4 وحديد');
    await coachH.handleFreeText(f);
    assert.equal(called, false);
    assert.equal(f.replies.length, 0);
  } finally {
    global.fetch = realFetch;
    delete process.env.DEEPSEEK_API_KEY;
  }
});

test('/coach opt-in: start defaults to latest weigh-in; explicit start; off', async () => {
  db.users.push({ telegram_user_id: USER });
  db.weight_entries.push({ user_id: USER, weight: 111.2, recorded_at: '2026-11-12' });

  const intro = ctx('/coach');
  await coachH.handleCoach(intro);
  assert.match(intro.replies[0].text, /\/coach 80/);

  const c = ctx('/coach ٨٠');
  await coachH.handleCoach(c);
  let s = db.coach_settings[0];
  assert.equal(s.coach_enabled, true);
  assert.equal(s.start_weight, 111.2);
  assert.equal(s.goal_weight, 80);

  await coachH.handleCoach(ctx('/coach 80 112'));
  assert.equal(db.coach_settings[0].start_weight, 112);

  const bad = ctx('/coach 120');
  await coachH.handleCoach(bad);
  assert.match(bad.replies[0].text, /لازم يكون أقل/);

  await coachH.handleCoach(ctx('/coach off'));
  assert.equal(db.coach_settings[0].coach_enabled, false);
});
