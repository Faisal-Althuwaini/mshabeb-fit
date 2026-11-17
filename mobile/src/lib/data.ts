// Reads and writes against the same Supabase database as the website (RLS protects each user's rows).
import { supabase } from './supabase';
import type { Bundle, Check, Settings, WhoAmI } from './types';

const must = <T>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

export const whoami = async () => must(await supabase.rpc('whoami')) as WhoAmI;

export const loadSettings = async (ownerId: number) =>
  must(await supabase.from('coach_settings').select('*').eq('user_id', ownerId).single()) as Settings;

/** Weights + daily checks in one round trip (RPC get_bundle, also used by the website). */
export async function loadBundle(ownerId: number): Promise<Bundle> {
  const raw = must(await supabase.rpc('get_bundle', { p_owner: ownerId })) as {
    entries: { date: string; weight: number | string }[];
    checks: Check[];
  };
  return {
    entries: raw.entries.map((e) => ({ date: e.date, weight: Number(e.weight) })),
    checks: raw.checks,
  };
}

export async function saveWeight(ownerId: number, day: string, weight: number) {
  must(await supabase.from('weight_entries').upsert(
    { user_id: ownerId, weight, recorded_at: day, source: 'pwa' },
    { onConflict: 'user_id,recorded_at' },
  ));
}

export async function saveCheck(ownerId: number, day: string, patch: Partial<Pick<Check, 'minimum_done' | 'lifted'>>) {
  must(await supabase.from('daily_checks').upsert({ user_id: ownerId, day, ...patch }, { onConflict: 'user_id,day' }));
}
