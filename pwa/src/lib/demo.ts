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
    flex: [],
    events: [],
    reactions: [{ owner_user_id: 1, item_kind: 'day', item_ref: S.addDays(today, -1), author_auth_user_id: 'friend', emoji: '🔥', created_at: new Date().toISOString() }],
    comments: [{ id: 1, owner_user_id: 1, item_kind: 'meal', item_ref: '1', author_auth_user_id: 'friend', author_name: 'سعد', body: 'كفو 👏 بس وين السلطة؟', created_at: new Date().toISOString() }],
  };
  const who: WhoAmI = role === 'owner'
    ? { telegram_user_id: 1, first_name: 'فيصل', coach_enabled: true, watching: [] }
    : { telegram_user_id: null, first_name: null, coach_enabled: false, watching: [{ owner_user_id: 1, first_name: 'فيصل', ...settings }], my_watcher_name: 'سعد' };
  return { settings, bundle, who };
}
