// Offline queue for weigh-ins and daily checks (plan §7.4). Uses IndexedDB via idb-keyval.
// Also caches the last loaded data so the app can show something offline.
import { get, set, del } from 'idb-keyval';
import { supabase } from './supabase';

export type QueuedWrite =
  | { kind: 'weight'; row: { user_id: number; weight: number; recorded_at: string; source: 'pwa' } }
  | { kind: 'check'; row: { user_id: number; day: string; minimum_done?: boolean; lifted?: boolean; workout_label?: string | null } };

const QUEUE_KEY = 'write-queue-v1';

async function readQueue(): Promise<QueuedWrite[]> {
  try { return ((await get(QUEUE_KEY)) as QueuedWrite[]) || []; } catch { return []; }
}

async function send(w: QueuedWrite) {
  if (w.kind === 'weight') {
    const { error } = await supabase.from('weight_entries').upsert(w.row, { onConflict: 'user_id,recorded_at' });
    if (error) throw error;
  } else {
    const { error } = await supabase.from('daily_checks').upsert(w.row, { onConflict: 'user_id,day' });
    if (error) throw error;
  }
}

const isNetworkError = (e: unknown) =>
  !navigator.onLine || (e instanceof TypeError) || /fetch|network/i.test(String((e as Error)?.message || e));

/** Write now; if offline / network fails, queue it. Returns 'sent' | 'queued'. */
export async function writeOrQueue(w: QueuedWrite): Promise<'sent' | 'queued'> {
  if (navigator.onLine) {
    try { await send(w); return 'sent'; } catch (e) { if (!isNetworkError(e)) throw e; }
  }
  const q = await readQueue();
  // Keep only the latest write per (kind, key) — e.g. editing today's weight twice offline.
  const key = (x: QueuedWrite) => (x.kind === 'weight' ? `w:${x.row.recorded_at}` : `c:${x.row.day}`);
  const merged = q.filter((x) => key(x) !== key(w));
  if (w.kind === 'check') {
    const prev = q.find((x) => key(x) === key(w)) as Extract<QueuedWrite, { kind: 'check' }> | undefined;
    if (prev) w = { kind: 'check', row: { ...prev.row, ...w.row } };
  }
  merged.push(w);
  await set(QUEUE_KEY, merged);
  return 'queued';
}

export async function pendingCount() { return (await readQueue()).length; }

/** Try to send everything queued. Returns how many were sent. */
export async function flushQueue(): Promise<number> {
  const q = await readQueue();
  if (q.length === 0 || !navigator.onLine) return 0;
  const left: QueuedWrite[] = [];
  let sent = 0;
  for (const w of q) {
    try { await send(w); sent += 1; } catch (e) { if (isNetworkError(e)) left.push(w); else console.error('dropping bad queued write', e); }
  }
  if (left.length) await set(QUEUE_KEY, left); else await del(QUEUE_KEY);
  return sent;
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  try { return (await get(`cache:${key}`)) as T | undefined; } catch { return undefined; }
}
export async function cacheSet(key: string, value: unknown) {
  try { await set(`cache:${key}`, value); } catch { /* storage unavailable */ }
}
