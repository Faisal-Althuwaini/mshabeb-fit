import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../shared/stats.mjs';

test('normalizeDigits handles Arabic-Indic, Persian and decimal separators', () => {
  assert.equal(S.normalizeDigits('١١٢٫٤'), '112.4');
  assert.equal(S.normalizeDigits('۱۱۲٫۴'), '112.4');
  assert.equal(S.normalizeDigits('112,4'), '112.4');
  assert.equal(S.normalizeDigits('112.4'), '112.4');
});

test('parseWeightInput', () => {
  assert.deepEqual(S.parseWeightInput('١١٢٫٤'), { ok: true, value: 112.4 });
  assert.deepEqual(S.parseWeightInput(' 112,45 '), { ok: true, value: 112.5 });
  assert.deepEqual(S.parseWeightInput('39.9'), { ok: false, reason: 'range' });
  assert.deepEqual(S.parseWeightInput('251'), { ok: false, reason: 'range' });
  assert.deepEqual(S.parseWeightInput('abc'), { ok: false, reason: 'nan' });
  assert.deepEqual(S.parseWeightInput('112.4 kg'), { ok: false, reason: 'nan' });
  assert.equal(S.isNumberMessage('١١٢'), true);
  assert.equal(S.isNumberMessage('112.4 وحديد'), false);
});

test('toArabicDigits / formatDelta', () => {
  assert.equal(S.toArabicDigits(112.4), '١١٢٫٤');
  assert.equal(S.toArabicDigits(110), '١١٠');
  assert.equal(S.formatDelta(-0.5), '−٠٫٥');
  assert.equal(S.formatDelta(0.3), '+٠٫٣');
  assert.equal(S.formatDelta(0.04), '٠');
});

test('localDate uses Riyadh time (UTC+3)', () => {
  // 2026-11-14 22:30 UTC = 2026-11-15 01:30 Riyadh
  assert.equal(S.localDate(new Date('2026-11-14T22:30:00Z')), '2026-11-15');
  assert.equal(S.localDate(new Date('2026-11-14T20:59:00Z')), '2026-11-14');
  assert.equal(S.localMinutes(new Date('2026-11-14T08:00:00Z')), 11 * 60);
});

test('weekStart is Sunday by default', () => {
  // 2026-11-15 is a Sunday
  assert.equal(S.dayOfWeek('2026-11-15'), 0);
  assert.equal(S.weekStart('2026-11-15'), '2026-11-15');
  assert.equal(S.weekStart('2026-11-21'), '2026-11-15'); // Saturday
  assert.equal(S.weekStart('2026-11-22'), '2026-11-22');
  assert.equal(S.weekStart('2026-11-17', 1), '2026-11-16'); // Monday-start option
});

test('average matches the original Math.round(mean*10)/10 and avoids float drift', () => {
  assert.equal(S.average([]), null);
  assert.equal(S.average([112.4, 112.9, 112.8]), 112.7);
  assert.equal(S.average([112.2, 112.3]), 112.3); // 112.25 → half up
  assert.equal(S.average(['100.05', '100.10']), 100.1); // 100.075 → 100.1
  const orig = (ws) => Math.round((ws.reduce((s, w) => s + w, 0) / ws.length) * 10) / 10;
  for (const ws of [[111.3, 112.8, 110.1, 109.9], [80, 81.5], [99.95, 100.0, 100.05]]) {
    assert.equal(S.average(ws), orig(ws));
  }
});

test('weeklyStats groups by week, counts checks, marks complete weeks', () => {
  const entries = [
    { date: '2026-11-08', weight: 113 },
    { date: '2026-11-09', weight: 113.4 },
    { date: '2026-11-15', weight: 112.4 }, // Sun
    { date: '2026-11-16', weight: 112.9 },
    { date: '2026-11-17', weight: 112.8 },
  ];
  const checks = [
    { day: '2026-11-15', minimum_done: true, lifted: true },
    { day: '2026-11-16', minimum_done: true, lifted: false },
    { day: '2026-11-18', minimum_done: false, lifted: true },
  ];
  const w = S.weeklyStats(entries, checks);
  assert.equal(w.length, 2);
  assert.deepEqual(w[0], {
    week_start: '2026-11-08', avg_weight: 113.2, n_weighins: 2,
    minimum_days: 0, lifting_days: 0, is_complete: false,
  });
  assert.deepEqual(w[1], {
    week_start: '2026-11-15', avg_weight: 112.7, n_weighins: 3,
    minimum_days: 2, lifting_days: 2, is_complete: true,
  });
});

test('streaks and missed days', () => {
  const active = S.activeDays(
    [{ date: '2026-11-10', weight: 1 }, { date: '2026-11-11', weight: 1 }, { date: '2026-11-13', weight: 1 }],
    [{ day: '2026-11-12', minimum_done: true }, { day: '2026-11-05', minimum_done: true }, { day: '2026-11-14', minimum_done: false }],
  );
  // 10,11,12,13 active → streak 4 ending yesterday when today = 14
  assert.equal(S.currentStreak(active, '2026-11-14'), 4);
  assert.equal(S.currentStreak(active, '2026-11-13'), 4);
  assert.equal(S.currentStreak(active, '2026-11-15'), 0);
  assert.equal(S.bestStreak(active), 4);
  assert.equal(S.missedDays(active, '2026-11-13'), 0);
  assert.equal(S.missedDays(active, '2026-11-17'), 4);
  assert.equal(S.missedDays(new Set(), '2026-11-17'), null);
});

test('ladder', () => {
  const steps = S.ladderSteps(112, 80, 2);
  assert.equal(steps[0], 112);
  assert.equal(steps[1], 110);
  assert.equal(steps.at(-1), 80);
  assert.equal(steps.length, 17);
  assert.deepEqual(S.ladderSteps(111, 80, 2).slice(-2), [81, 80]);

  const settings = { start_weight: 112, goal_weight: 80, ladder_step: 2 };
  const weekly = [
    { week_start: '2026-11-01', avg_weight: 111.5, is_complete: true },
    { week_start: '2026-11-08', avg_weight: 109.8, is_complete: false }, // incomplete: doesn't count
    { week_start: '2026-11-15', avg_weight: 110.4, is_complete: true },
  ];
  const p = S.ladderProgress(weekly, settings);
  assert.deepEqual(p.reached, [112]);
  assert.equal(p.next, 110);
  assert.equal(p.remaining_to_next, 0.4);

  weekly.push({ week_start: '2026-11-22', avg_weight: 109.9, is_complete: true });
  assert.deepEqual(S.newlyReachedSteps(weekly, settings, '2026-11-22'), [110]);
  assert.deepEqual(S.newlyReachedSteps(weekly, settings, '2026-11-15'), []);
});

test('buildSnapshot', () => {
  const settings = { start_weight: 112, goal_weight: 80, ladder_step: 2, week_start_dow: 0 };
  const snap = S.buildSnapshot({
    entries: [
      { date: '2026-11-10', weight: 113.0 },
      { date: '2026-11-11', weight: 113.4 },
      { date: '2026-11-12', weight: 113.2 },
      { date: '2026-11-15', weight: 112.4 },
      { date: '2026-11-16', weight: 112.9 },
    ],
    checks: [{ day: '2026-11-14', minimum_done: true }],
    settings,
    today: '2026-11-16',
  });
  assert.equal(snap.thisWeek.avg_weight, 112.7);
  assert.equal(snap.lastWeek.avg_weight, 113.2);
  assert.equal(snap.weekChange, -0.5);
  assert.equal(snap.todayWeight, 112.9);
  assert.equal(snap.previousWeight, 112.4);
  assert.equal(snap.streak, 3); // 14, 15, 16
  assert.equal(snap.missedDays, 0);
  assert.equal(snap.totalLost, -1.2); // only last week is complete (113.2)
});
