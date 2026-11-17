// The parts of the Supabase schema the app uses (mirrors pwa/src/lib/types.ts).
export type Entry = { date: string; weight: number };

export type Check = {
  day: string;
  minimum_done: boolean;
  lifted: boolean;
  workout_label: string | null;
  steps?: number | null;
  strength_minutes?: number | null;
  sleep_minutes?: number | null;
  health_synced_at?: string | null;
};

export type Settings = {
  user_id: number;
  coach_enabled: boolean;
  start_weight: number | null;
  goal_weight: number | null;
  ladder_step: number;
  minimum_action: string;
  lifting_days_required: number;
  week_start_dow: number;
  timezone: string;
  coach_started_on: string | null;
  display_name: string | null;
  steps_goal?: number;
};

export type WhoAmI = {
  telegram_user_id: number | null;
  first_name: string | null;
  coach_enabled: boolean;
};

export type Bundle = { entries: Entry[]; checks: Check[] };
