// Pure: turn a Bundle into day cards for the watch feed (D14–D16).
import type { Bundle } from './data';
import type { Check, Comment, FeedEvent, FlexPhoto, ItemKind, MealPost, Reaction } from './types';
import * as S from './stats';

export type DayCard = {
  day: string;
  weight: number | null;
  check: Check | null;
  meals: MealPost[];
  flex: FlexPhoto[];
  events: FeedEvent[];
};

/** Most recent first. Only shared flex photos appear in the feed (D15), for owner and watcher alike. */
export function buildDays(b: Bundle, limitDays = 30): DayCard[] {
  const days = new Map<string, DayCard>();
  const card = (d: string) => {
    if (!days.has(d)) days.set(d, { day: d, weight: null, check: null, meals: [], flex: [], events: [] });
    return days.get(d)!;
  };
  for (const e of b.entries) card(e.date).weight = e.weight;
  for (const c of b.checks) if (c.minimum_done || c.lifted) card(c.day).check = c;
  for (const m of b.meals) card(m.local_date).meals.push(m);
  for (const f of b.flex) if (f.shared_with_watchers) card(f.taken_on).flex.push(f);
  for (const ev of b.events) card(ev.local_date).events.push(ev);
  for (const c of days.values()) c.meals.sort((a, z) => a.posted_at.localeCompare(z.posted_at));
  return [...days.values()].sort((a, z) => z.day.localeCompare(a.day)).slice(0, limitDays);
}

export const itemKey = (kind: ItemKind, ref: string | number) => `${kind}:${ref}`;

export function indexSocial(reactions: Reaction[], comments: Comment[]) {
  const r = new Map<string, Reaction[]>();
  const c = new Map<string, Comment[]>();
  for (const x of reactions) { const k = itemKey(x.item_kind, x.item_ref); (r.get(k) || r.set(k, []).get(k)!).push(x); }
  for (const x of comments) { const k = itemKey(x.item_kind, x.item_ref); (c.get(k) || c.set(k, []).get(k)!).push(x); }
  return { reactions: r, comments: c };
}

/** Comments/reactions by someone else since `sinceIso` (unread badge when push is off). */
export function unreadCount(b: Bundle, me: string, sinceIso: string | null) {
  const since = sinceIso || '1970-01-01';
  return (
    b.comments.filter((c) => c.author_auth_user_id !== me && c.created_at > since).length +
    b.reactions.filter((r) => r.author_auth_user_id !== me && r.created_at > since).length +
    b.events.filter((e) => e.created_at > since).length
  );
}

/**
 * The 4-week target line (plan §7.3): from start_weight on coach_started_on, dropping
 * target_loss_per_4w every 28 days, never below goal. Returns [date, weight] pairs.
 */
export function targetLine(
  s: { start_weight: number | null; goal_weight: number | null; target_loss_per_4w: number; coach_started_on: string | null },
  untilDay: string
): { date: string; target: number }[] {
  if (s.start_weight == null || s.goal_weight == null || !s.coach_started_on) return [];
  const start = Number(s.start_weight);
  const goal = Number(s.goal_weight);
  const perDay = Number(s.target_loss_per_4w) / 28;
  const daysToGoal = Math.ceil((start - goal) / perDay);
  const span = Math.max(0, S.daysBetween(s.coach_started_on, untilDay));
  const end = Math.min(span, daysToGoal);
  const pts = [{ date: s.coach_started_on, target: start }];
  if (end > 0) pts.push({ date: S.addDays(s.coach_started_on, end), target: Math.max(goal, start - perDay * end) });
  if (span > end) pts.push({ date: untilDay, target: goal });
  return pts;
}
