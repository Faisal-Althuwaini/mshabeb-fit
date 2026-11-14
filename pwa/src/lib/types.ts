export type Entry = { date: string; weight: number };
export type Check = { day: string; minimum_done: boolean; lifted: boolean; workout_label: string | null };

export type Settings = {
  user_id: number;
  coach_enabled: boolean;
  start_weight: number | null;
  goal_weight: number | null;
  target_loss_per_4w: number;
  ladder_step: number;
  minimum_action: string;
  lifting_days_required: number;
  week_start_dow: number;
  timezone: string;
  morning_check_time: string;
  evening_check_time: string;
  quiet_start: string;
  quiet_end: string;
  weekly_report_dow: number;
  weekly_report_time: string;
  paused_until: string | null;
  coach_started_on: string | null;
  display_name: string | null;
};

export type WatchedOwner = {
  owner_user_id: number;
  first_name: string | null;
  start_weight: number | null;
  goal_weight: number | null;
  ladder_step: number;
  target_loss_per_4w: number;
  week_start_dow: number;
  timezone: string;
  coach_started_on: string | null;
  lifting_days_required: number;
  minimum_action: string;
};

export type WhoAmI = {
  telegram_user_id: number | null;
  first_name: string | null;       // app display name, falling back to the Telegram name
  display_name?: string | null;
  telegram_name?: string | null;
  my_watcher_name?: string | null; // the name my friends see on my comments
  coach_enabled: boolean;
  watching: WatchedOwner[];
};

export type MealPost = {
  id: number; user_id: number; local_date: string; posted_at: string;
  storage_path: string; caption: string | null; source: 'telegram' | 'pwa';
};
export type FlexPhoto = {
  id: number; user_id: number; taken_on: string; storage_path: string;
  weight_at_time: number | null; shared_with_watchers: boolean; caption: string | null;
  is_comparison: boolean; created_at: string; post_id: number | null; position: number;
};
export type FlexPost = {
  id: number; user_id: number; taken_on: string; weight: number | null; caption: string | null;
  shared_with_watchers: boolean; is_comparison: boolean; created_at: string;
};
export type Measurement = {
  user_id: number; day: string; waist_cm: number | null; chest_cm: number | null; hips_cm: number | null;
  arm_cm: number | null; thigh_cm: number | null; neck_cm: number | null; body_fat_pct: number | null;
};
export type MeasureKey = 'waist_cm' | 'chest_cm' | 'hips_cm' | 'arm_cm' | 'thigh_cm' | 'neck_cm' | 'body_fat_pct';
export const MEASURE_FIELDS: { key: MeasureKey; label: string; unit: string }[] = [
  { key: 'waist_cm', label: 'الخصر', unit: 'سم' },
  { key: 'chest_cm', label: 'الصدر', unit: 'سم' },
  { key: 'hips_cm', label: 'الورك', unit: 'سم' },
  { key: 'arm_cm', label: 'الذراع', unit: 'سم' },
  { key: 'thigh_cm', label: 'الفخذ', unit: 'سم' },
  { key: 'neck_cm', label: 'الرقبة', unit: 'سم' },
  { key: 'body_fat_pct', label: 'نسبة الدهون', unit: '٪' },
];
export type FeedEvent = { id: number; owner_user_id: number; kind: 'missed_days' | 'milestone'; local_date: string; data: { days?: number; step?: number; avg?: number } | null; created_at: string };
export type ItemKind = 'meal' | 'flex' | 'day';
export type Reaction = { owner_user_id: number; item_kind: ItemKind; item_ref: string; author_auth_user_id: string; emoji: string; created_at: string };
export type Comment = { id: number; owner_user_id: number; item_kind: ItemKind; item_ref: string; author_auth_user_id: string; author_name: string | null; body: string; created_at: string };
export type FeedView = { owner_user_id: number; item_kind: ItemKind; item_ref: string; viewer_auth_user_id: string; seen_at: string };
export type CoachMessage = {
  id: number; kind: 'nudge_morning' | 'nudge_firm' | 'comeback' | 'weekly_report' | 'trend_alert' | 'milestone' | 'lifting_check' | 'chat_user' | 'chat_coach';
  content: string; data: Record<string, unknown> | null; created_at: string; used_fallback: boolean;
};
export type WeeklyReport = { headline: string; went_well: string[]; watch_out: string[]; focus_next_week: string; tone: 'celebrate' | 'steady' | 'push' | 'comeback' };
export type Watcher = { owner_user_id: number; watcher_auth_user_id: string; display_name: string | null; created_at: string };

/** Who we're looking at: the owner themself, or the person a watcher follows. */
export type Subject = {
  ownerId: number;
  name: string;
  isOwner: boolean;
  settings: Pick<Settings, 'start_weight' | 'goal_weight' | 'ladder_step' | 'target_loss_per_4w' | 'week_start_dow' | 'timezone' | 'coach_started_on' | 'lifting_days_required' | 'minimum_action'>;
};
