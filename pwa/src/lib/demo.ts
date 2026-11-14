// DEV ONLY (?demo=owner or ?demo=watcher): fake data to check screens without a real account.
// Never included in production builds (guarded by import.meta.env.DEV in App.tsx).
import * as S from './stats';
import type { Bundle } from './data';
import type { Settings, WhoAmI } from './types';

export function demoData(today: string, role: 'owner' | 'watcher') {
  const settings: Settings = {
    user_id: 1, coach_enabled: true, start_weight: 112, goal_weight: 90, target_loss_per_4w: 3, ladder_step: 2,
    minimum_action: 'مشي ١٥ دقيقة', lifting_days_required: 2, week_start_dow: 0, timezone: 'Asia/Riyadh',
    morning_check_time: '11:00:00', evening_check_time: '20:00:00', quiet_start: '23:00:00', quiet_end: '08:00:00',
    weekly_report_dow: 6, weekly_report_time: '21:00:00', paused_until: null, coach_started_on: S.addDays(today, -69), display_name: 'فيصل',
  };
  const entries = [], checks = [];
  let w = 112.6;
  for (let i = 69; i >= 1; i--) {
    const d = S.addDays(today, -i);
    if (i >= 30 && i <= 34) continue; // a 5-day gap
    w += -0.09 + Math.sin(i * 1.7) * 0.35 + (i > 14 && i < 28 ? 0.06 : 0);
    if (i % 4 !== 0) entries.push({ date: d, weight: Math.round(w * 10) / 10 });
    checks.push({ day: d, minimum_done: i % 3 !== 0, lifted: [1, 4].includes(S.dayOfWeek(d)), workout_label: S.dayOfWeek(d) === 1 ? 'anterior' : 'posterior' });
  }
  const bundle: Bundle = {
    entries, checks,
    meals: [{ id: 1, user_id: 1, local_date: S.addDays(today, -1), posted_at: new Date(Date.now() - 86400000).toISOString(), storage_path: 'demo.jpg', caption: 'غدا: صدر دجاج ورز', source: 'telegram' }],
    flex: [0, 1, 2].map((i) => ({ id: 100 + i, user_id: 1, taken_on: S.addDays(today, -1), storage_path: `demo-flex-${i}`, weight_at_time: 107.3, shared_with_watchers: true, caption: null, is_comparison: false, created_at: new Date().toISOString(), post_id: 11, position: i }))
      .concat([0, 1].map((i) => ({ id: 200 + i, user_id: 1, taken_on: S.addDays(today, -36), storage_path: `demo-flex-old-${i}`, weight_at_time: 110.6, shared_with_watchers: false, caption: null, is_comparison: false, created_at: new Date().toISOString(), post_id: 10, position: i }))),
    events: [],
    reactions: [{ owner_user_id: 1, item_kind: 'day', item_ref: S.addDays(today, -1), author_auth_user_id: 'friend', emoji: '🔥', created_at: new Date().toISOString() }],
    views: [{ owner_user_id: 1, item_kind: 'meal', item_ref: '1', viewer_auth_user_id: 'friend', seen_at: new Date().toISOString() }],
    watchers: [{ owner_user_id: 1, watcher_auth_user_id: 'friend', display_name: 'سعد', created_at: new Date().toISOString() }],
    flexPosts: [
      { id: 11, user_id: 1, taken_on: S.addDays(today, -1), weight: 107.3, caption: 'الأسبوع ١٠', shared_with_watchers: true, is_comparison: false, created_at: new Date().toISOString() },
      { id: 10, user_id: 1, taken_on: S.addDays(today, -36), weight: 110.6, caption: null, shared_with_watchers: false, is_comparison: false, created_at: new Date().toISOString() },
    ],
    measurements: [
      { user_id: 1, day: S.addDays(today, -36), waist_cm: 108, chest_cm: 118, hips_cm: 114, arm_cm: 38, thigh_cm: 66, neck_cm: 44, body_fat_pct: 31 },
      { user_id: 1, day: S.addDays(today, -1), waist_cm: 104.5, chest_cm: 116, hips_cm: 112, arm_cm: 38.5, thigh_cm: 65, neck_cm: 43, body_fat_pct: null },
    ],
    comments: [{ id: 1, owner_user_id: 1, item_kind: 'meal', item_ref: '1', author_auth_user_id: 'friend', author_name: 'سعد', body: 'كفو 👏 بس وين السلطة؟', created_at: new Date().toISOString() }],
  };
  const who: WhoAmI = role === 'owner'
    ? { telegram_user_id: 1, first_name: 'فيصل', coach_enabled: true, watching: [] }
    : { telegram_user_id: null, first_name: null, coach_enabled: false, watching: [{ owner_user_id: 1, first_name: 'فيصل', ...settings }], my_watcher_name: 'سعد' };
  return { settings, bundle, who };
}

export const isDemo = () => import.meta.env.DEV && new URLSearchParams(location.search).has('demo');

export function demoCoachMessages() {
  const now = Date.now();
  const iso = (minsAgo: number) => new Date(now - minsAgo * 60000).toISOString();
  return [
    { id: 5, kind: 'chat_coach', content: 'عادي جداً 👌 الوزن اليومي يتأثر بالملح والماي. متوسطك هالأسبوع ١٠٧٫٢ وهو أقل من اللي فات. كمّل أقل شي اليوم وبس.', data: null, created_at: iso(3), used_fallback: false },
    { id: 4, kind: 'chat_user', content: 'ليه وزني اليوم زاد؟', data: null, created_at: iso(4), used_fallback: false },
    { id: 3, kind: 'nudge_morning', content: 'صباح الخير 👋 لا تنسى ترسل وزنك اليوم، وخلّ أقل شي (مشي ١٥ دقيقة) في بالك.', data: null, created_at: iso(300), used_fallback: true },
    { id: 2, kind: 'weekly_report', content: '📊 أسبوع نازل 👏', created_at: iso(60 * 30), used_fallback: false, data: { report: {
      headline: 'أسبوع نازل 👏 كمّل كذا', went_well: ['المتوسط نزل ٠٫٦ كيلو', 'سويت أقل شي ٥ أيام'],
      watch_out: ['الحديد ١ من ٢، باقي حصة'], focus_next_week: 'حصتين حديد: أمامي الأحد وخلفي الأربعاء', tone: 'celebrate' } } },
  ] as const;
}
