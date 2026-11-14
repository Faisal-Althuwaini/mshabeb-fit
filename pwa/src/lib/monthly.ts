// Pure: everything the monthly summary image shows, for one calendar month.
import * as S from './stats';
import type { Bundle } from './data';
import type { FlexPhoto, FlexPost, Measurement, MeasureKey } from './types';

export const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export type MonthKey = string; // 'YYYY-MM'

export type MonthlySummary = {
  month: MonthKey;
  label: string; // «نوفمبر ٢٠٢٦»
  from: string; to: string; // date range covered (to = today for the current month)
  weighIns: number;
  startWeight: number | null; endWeight: number | null; change: number | null;
  bestStreak: number;
  minimumDays: number; liftingDays: number; days: number;
  measures: { key: MeasureKey; from: number; to: number; change: number }[];
  before: { post: FlexPost; photo: FlexPhoto } | null;
  after: { post: FlexPost; photo: FlexPhoto } | null;
  nextStep: number | null; remaining: number | null;
};

const monthOf = (d: string) => d.slice(0, 7);
const lastDay = (m: MonthKey) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
};
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

/** Months that have any data, newest first. */
export function availableMonths(b: Bundle, today: string): MonthKey[] {
  const set = new Set<MonthKey>([monthOf(today)]);
  for (const e of b.entries) set.add(monthOf(e.date));
  for (const c of b.checks) set.add(monthOf(c.day));
  return [...set].filter((m) => m <= monthOf(today)).sort().reverse();
}

/** Default: last month during the first 5 days of a month, otherwise this month so far. */
export function defaultMonth(today: string): MonthKey {
  const d = Number(today.slice(8, 10));
  if (d > 5) return monthOf(today);
  return monthOf(S.addDays(`${monthOf(today)}-01`, -1));
}

export function monthlySummary(b: Bundle, month: MonthKey, today: string, settings: { start_weight: number | null; goal_weight: number | null; ladder_step: number; coach_started_on: string | null; week_start_dow?: number }): MonthlySummary {
  const from = `${month}-01`;
  const to = month === monthOf(today) ? today : lastDay(month);
  const inMonth = (d: string) => d >= from && d <= to;
  const [y, mo] = month.split('-').map(Number);

  // Weight: average of the first 3 vs last 3 weigh-ins of the month (smooths daily noise).
  const ws = b.entries.filter((e) => inMonth(e.date)).sort((a, c) => a.date.localeCompare(c.date));
  const startWeight = avg(ws.slice(0, 3).map((e) => e.weight));
  const endWeight = ws.length >= 2 ? avg(ws.slice(-3).map((e) => e.weight)) : null;
  const change = startWeight != null && endWeight != null && ws.length >= 4 ? Math.round((endWeight - startWeight) * 10) / 10 : null;

  // Activity
  const checks = b.checks.filter((c) => inMonth(c.day));
  const active = S.activeDays(ws, checks);
  const bestStreak = S.bestStreak(active);

  // Measurements: last value before/at the start of the month (or first in month) → last in month.
  const ms = [...b.measurements].sort((a, c) => a.day.localeCompare(c.day));
  const startM = [...ms].reverse().find((m) => m.day < from) || ms.find((m) => inMonth(m.day)) || null;
  const endM = [...ms].reverse().find((m) => inMonth(m.day)) || null;
  const keys: MeasureKey[] = ['waist_cm', 'chest_cm', 'hips_cm', 'arm_cm', 'thigh_cm', 'neck_cm', 'body_fat_pct'];
  const measures = startM && endM && startM !== endM
    ? keys.flatMap((k) => {
        const a = (startM as Measurement)[k], c = (endM as Measurement)[k];
        return a != null && c != null ? [{ key: k, from: a, to: c, change: Math.round((c - a) * 10) / 10 }] : [];
      })
    : [];

  // Photos: last flex before the month (or first in it) vs the latest in it.
  const firstPhoto = (p: FlexPost) => b.flex.filter((ph) => ph.post_id === p.id).sort((a, c) => a.position - c.position)[0];
  const posts = b.flexPosts.filter((p) => !p.is_comparison && firstPhoto(p)).sort((a, c) => a.taken_on.localeCompare(c.taken_on));
  const beforePost = [...posts].reverse().find((p) => p.taken_on < from) || posts.find((p) => inMonth(p.taken_on)) || null;
  const afterPost = [...posts].reverse().find((p) => inMonth(p.taken_on)) || null;
  const pair = beforePost && afterPost && beforePost.id !== afterPost.id;

  const snap = S.buildSnapshot({ entries: b.entries.filter((e) => e.date <= to), checks: b.checks.filter((c) => c.day <= to), settings: { ...settings, week_start_dow: settings.week_start_dow ?? 0 }, today: to });

  return {
    month, label: `${MONTHS_AR[mo - 1]} ${S.toArabicDigits(y, 0)}`, from, to,
    weighIns: ws.length, startWeight, endWeight, change, bestStreak,
    minimumDays: checks.filter((c) => c.minimum_done).length,
    liftingDays: checks.filter((c) => c.lifted).length,
    days: S.daysBetween(from, to) + 1,
    measures,
    before: pair ? { post: beforePost!, photo: firstPhoto(beforePost!) } : null,
    after: pair ? { post: afterPost!, photo: firstPhoto(afterPost!) } : afterPost ? { post: afterPost, photo: firstPhoto(afterPost) } : null,
    nextStep: snap.ladder.next, remaining: snap.ladder.remaining_to_next,
  };
}
