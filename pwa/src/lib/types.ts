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
  is_comparison: boolean; created_at: string;
};
export type FeedEvent = { id: number; owner_user_id: number; kind: 'missed_days'; local_date: string; data: { days: number } | null; created_at: string };
export type ItemKind = 'meal' | 'flex' | 'day';
export type Reaction = { owner_user_id: number; item_kind: ItemKind; item_ref: string; author_auth_user_id: string; emoji: string; created_at: string };
export type Comment = { id: number; owner_user_id: number; item_kind: ItemKind; item_ref: string; author_auth_user_id: string; author_name: string | null; body: string; created_at: string };
export type Watcher = { owner_user_id: number; watcher_auth_user_id: string; display_name: string | null; created_at: string };

/** Who we're looking at: the owner themself, or the person a watcher follows. */
export type Subject = {
  ownerId: number;
  name: string;
  isOwner: boolean;
  settings: Pick<Settings, 'start_weight' | 'goal_weight' | 'ladder_step' | 'target_loss_per_4w' | 'week_start_dow' | 'timezone' | 'coach_started_on' | 'lifting_days_required' | 'minimum_action'>;
};
