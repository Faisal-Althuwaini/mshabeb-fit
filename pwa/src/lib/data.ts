// All reads/writes the PWA does. RLS decides what each user can see (D4, D12, D14).
import { supabase } from './supabase';
import { writeOrQueue, cacheGet, cacheSet } from './offline';
import { resizeImage } from './image';
import { isDemo, demoCoachMessages } from './demo';
import type {
  Check, CoachMessage, Comment, Entry, FeedEvent, FeedView, FlexPhoto, ItemKind, MealPost, Reaction, Settings, Watcher, WhoAmI,
} from './types';

const must = <T>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

export async function whoami(): Promise<WhoAmI> {
  return must(await supabase.rpc('whoami')) as WhoAmI;
}

export async function loadSettings(ownerId: number): Promise<Settings> {
  return must(await supabase.from('coach_settings').select('*').eq('user_id', ownerId).single()) as Settings;
}

export async function saveSettings(ownerId: number, patch: Partial<Settings>) {
  must(await supabase.from('coach_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', ownerId));
}

export type Bundle = {
  entries: Entry[];
  checks: Check[];
  meals: MealPost[];
  flex: FlexPhoto[];
  events: FeedEvent[];
  reactions: Reaction[];
  comments: Comment[];
  views: FeedView[];
  watchers: Watcher[];
};

/** Everything for one person's feed / progress. Cached for offline use. */
export async function loadBundle(ownerId: number): Promise<Bundle> {
  const key = `bundle:${ownerId}`;
  try {
    const [w, c, m, f, e, r, cm, v, wa] = await Promise.all([
      supabase.from('weight_entries').select('weight, recorded_at').eq('user_id', ownerId).order('recorded_at'),
      // explicit columns: ate_out is not readable from the PWA (D14)
      supabase.from('daily_checks').select('day, minimum_done, lifted, workout_label').eq('user_id', ownerId).order('day'),
      supabase.from('meal_posts').select('*').eq('user_id', ownerId).order('posted_at', { ascending: false }).limit(300),
      supabase.from('flex_photos').select('*').eq('user_id', ownerId).order('taken_on', { ascending: false }),
      supabase.from('feed_events').select('*').eq('owner_user_id', ownerId).order('created_at', { ascending: false }).limit(50),
      supabase.from('feed_reactions').select('owner_user_id, item_kind, item_ref, author_auth_user_id, emoji, created_at').eq('owner_user_id', ownerId),
      supabase.from('feed_comments').select('id, owner_user_id, item_kind, item_ref, author_auth_user_id, author_name, body, created_at').eq('owner_user_id', ownerId).order('created_at'),
      supabase.from('feed_views').select('*').eq('owner_user_id', ownerId),
      supabase.from('watchers').select('*').eq('owner_user_id', ownerId),
    ]);
    const bundle: Bundle = {
      entries: must(w).map((x: { weight: number | string; recorded_at: string }) => ({ date: x.recorded_at, weight: Number(x.weight) })),
      checks: must(c) as Check[],
      meals: must(m) as MealPost[],
      flex: (must(f) as FlexPhoto[]).map((x) => ({ ...x, weight_at_time: x.weight_at_time == null ? null : Number(x.weight_at_time) })),
      events: must(e) as FeedEvent[],
      reactions: must(r) as Reaction[],
      comments: must(cm) as Comment[],
      views: (v.error ? [] : v.data) as FeedView[],
      watchers: (wa.error ? [] : wa.data) as Watcher[],
    };
    await cacheSet(key, bundle);
    return bundle;
  } catch (err) {
    const cached = await cacheGet<Bundle>(key);
    if (cached) return cached;
    throw err;
  }
}

// ── Owner writes ──────────────────────────────────────────────────────────

export const saveWeight = (ownerId: number, day: string, weight: number) =>
  writeOrQueue({ kind: 'weight', row: { user_id: ownerId, weight, recorded_at: day, source: 'pwa' } });

export const saveCheck = (ownerId: number, day: string, patch: Partial<Pick<Check, 'minimum_done' | 'lifted' | 'workout_label'>>) =>
  writeOrQueue({ kind: 'check', row: { user_id: ownerId, day, ...patch } });

async function uploadPhoto(bucket: 'meal-photos' | 'flex-photos', ownerId: number, day: string, file: Blob, alreadySized = false) {
  const blob = alreadySized ? file : await resizeImage(file);
  const path = `${ownerId}/${day}/${crypto.randomUUID()}.jpg`;
  must(await supabase.storage.from(bucket).upload(path, blob, { contentType: 'image/jpeg', upsert: false }));
  return path;
}

export async function postMeal(ownerId: number, day: string, file: File, caption: string) {
  const path = await uploadPhoto('meal-photos', ownerId, day, file);
  must(await supabase.from('meal_posts').insert({ user_id: ownerId, local_date: day, storage_path: path, caption: caption.trim() || null, source: 'pwa' }));
}

export async function deleteMeal(meal: MealPost) {
  must(await supabase.from('meal_posts').delete().eq('id', meal.id));
  await supabase.storage.from('meal-photos').remove([meal.storage_path]);
}

export async function addFlex(ownerId: number, day: string, file: Blob, opts: { weight: number | null; caption?: string; shared?: boolean; isComparison?: boolean; alreadySized?: boolean }) {
  const path = await uploadPhoto('flex-photos', ownerId, day, file, opts.alreadySized);
  must(await supabase.from('flex_photos').insert({
    user_id: ownerId, taken_on: day, storage_path: path, weight_at_time: opts.weight,
    caption: opts.caption?.trim() || null, shared_with_watchers: !!opts.shared, is_comparison: !!opts.isComparison,
  }));
}

export async function setFlexShared(id: number, shared: boolean) {
  must(await supabase.from('flex_photos').update({ shared_with_watchers: shared }).eq('id', id));
}

export async function deleteFlex(photo: FlexPhoto) {
  must(await supabase.from('flex_photos').delete().eq('id', photo.id));
  await supabase.storage.from('flex-photos').remove([photo.storage_path]);
}

// ── Signed URLs (private buckets) ─────────────────────────────────────────

const urlCache = new Map<string, { url: string; exp: number }>();
export async function signedUrls(bucket: 'meal-photos' | 'flex-photos', paths: string[]): Promise<Record<string, string>> {
  const now = Date.now();
  const out: Record<string, string> = {};
  const need = paths.filter((p) => {
    const c = urlCache.get(`${bucket}/${p}`);
    if (c && c.exp > now) { out[p] = c.url; return false; }
    return true;
  });
  if (need.length) {
    const res = must(await supabase.storage.from(bucket).createSignedUrls(need, 3600)) as { path: string | null; signedUrl: string }[];
    for (const r of res) {
      if (!r.path || !r.signedUrl) continue;
      out[r.path] = r.signedUrl;
      urlCache.set(`${bucket}/${r.path}`, { url: r.signedUrl, exp: now + 50 * 60 * 1000 });
    }
  }
  return out;
}

// ── Reactions & comments (D16) ────────────────────────────────────────────

export async function react(ownerId: number, kind: ItemKind, ref: string, me: string, emoji: string | null) {
  if (emoji == null) {
    must(await supabase.from('feed_reactions').delete()
      .eq('owner_user_id', ownerId).eq('item_kind', kind).eq('item_ref', ref).eq('author_auth_user_id', me));
    return;
  }
  must(await supabase.from('feed_reactions').upsert(
    { owner_user_id: ownerId, item_kind: kind, item_ref: ref, author_auth_user_id: me, emoji, created_at: new Date().toISOString(), notified_at: null },
    { onConflict: 'owner_user_id,item_kind,item_ref,author_auth_user_id' }
  ));
}

export async function addComment(ownerId: number, kind: ItemKind, ref: string, me: string, authorName: string | null, body: string) {
  must(await supabase.from('feed_comments').insert({
    owner_user_id: ownerId, item_kind: kind, item_ref: ref, author_auth_user_id: me, author_name: authorName, body: body.trim().slice(0, 280),
  }));
}

const seenSent = new Set<string>();
/** Watcher saw an item (first time only; the owner sees «👀 شافه»). */
export async function markSeen(ownerId: number, kind: ItemKind, ref: string, me: string) {
  const k = `${ownerId}:${kind}:${ref}`;
  if (seenSent.has(k)) return;
  seenSent.add(k);
  const { error } = await supabase.from('feed_views').upsert(
    { owner_user_id: ownerId, item_kind: kind, item_ref: ref, viewer_auth_user_id: me },
    { onConflict: 'owner_user_id,item_kind,item_ref,viewer_auth_user_id', ignoreDuplicates: true }
  );
  if (error) seenSent.delete(k);
}

export async function deleteComment(id: number) {
  must(await supabase.from('feed_comments').delete().eq('id', id));
}

// ── Linking & watchers ────────────────────────────────────────────────────

export const createLinkCode = async () => must(await supabase.rpc('create_link_code')) as string;
export const createWatchInvite = async () => must(await supabase.rpc('create_watch_invite')) as string;
export const acceptWatchInvite = async (code: string, name: string) =>
  must(await supabase.rpc('accept_watch_invite', { p_code: code, p_display_name: name })) as 'ok' | 'invalid' | 'expired' | 'self';

export async function listWatchers(ownerId: number): Promise<Watcher[]> {
  return must(await supabase.from('watchers').select('*').eq('owner_user_id', ownerId).order('created_at')) as Watcher[];
}
export async function removeWatcher(ownerId: number, watcherAuthId: string) {
  must(await supabase.from('watchers').delete().eq('owner_user_id', ownerId).eq('watcher_auth_user_id', watcherAuthId));
}
export async function setWatcherName(name: string) {
  must(await supabase.rpc('set_watcher_name', { p_name: name }));
}
export async function stopWatching(ownerId: number, me: string) {
  must(await supabase.from('watchers').delete().eq('owner_user_id', ownerId).eq('watcher_auth_user_id', me));
}

export async function loadCoachMessages(ownerId: number): Promise<CoachMessage[]> {
  if (isDemo()) return demoCoachMessages() as unknown as CoachMessage[];
  return must(await supabase.from('coach_messages').select('id, kind, content, data, created_at, used_fallback')
    .eq('user_id', ownerId).order('created_at', { ascending: false }).limit(150)) as CoachMessage[];
}

/** Chat with مشبب (edge function coach-chat). */
export async function sendChat(message: string): Promise<{ reply: string; remaining: number; limited?: boolean }> {
  if (isDemo()) return { reply: `(تجربة) وصلتني: ${message}`, remaining: 27 };
  const { data: d, error } = await supabase.functions.invoke('coach-chat', { body: { message } });
  if (error) {
    // 429 (daily limit) still carries a friendly reply in the body
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try { const body = await ctx.json(); if (body?.reply) return body; } catch { /* fallthrough */ }
    }
    throw new Error('مشبب ما رد، جرّب بعد شوي');
  }
  return d as { reply: string; remaining: number };
}

export async function latestCoachLine(ownerId: number, today: string): Promise<string | null> {
  const { data } = await supabase.from('coach_messages').select('content, created_at, local_date')
    .eq('user_id', ownerId).order('created_at', { ascending: false }).limit(1);
  const m = data?.[0];
  if (!m) return null;
  const day = m.local_date || String(m.created_at).slice(0, 10);
  return day === today ? (m.content as string).split('\n')[0] : null;
}

/** CSV export of weights + checks (Settings). */
export function toCsv(entries: Entry[], checks: Check[]) {
  const byDay = new Map<string, { weight?: number; min?: boolean; lift?: boolean; label?: string | null }>();
  for (const e of entries) byDay.set(e.date, { ...(byDay.get(e.date) || {}), weight: e.weight });
  for (const c of checks) byDay.set(c.day, { ...(byDay.get(c.day) || {}), min: c.minimum_done, lift: c.lifted, label: c.workout_label });
  const rows = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  return ['date,weight_kg,minimum_done,lifted,workout'].concat(
    rows.map(([d, v]) => [d, v.weight ?? '', v.min ? 1 : 0, v.lift ? 1 : 0, v.label ?? ''].join(','))
  ).join('\n');
}
