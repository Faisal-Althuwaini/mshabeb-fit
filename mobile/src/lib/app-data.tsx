// App-wide state: who's signed in, their settings and their data. Screens read it with useApp().
// Writes update the screen first (optimistic), then reconcile with the database.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import * as data from './data';
import * as S from './stats';
import type { Bundle, Check, Settings, WhoAmI } from './types';

type AppData = {
  who: WhoAmI | null;
  settings: Settings | null;
  bundle: Bundle | null;
  today: string;
  error: string | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
  logWeight: (weight: number, day?: string) => Promise<void>;
  toggleCheck: (key: 'minimum_done' | 'lifted', value: boolean, day?: string) => Promise<void>;
};

const Ctx = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [who, setWho] = useState<WhoAmI | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const today = S.localDate(new Date(), settings?.timezone || 'Asia/Riyadh');
  const ownerId = who?.telegram_user_id ?? null;

  // Fetch everything. No state is set before the first await, so it's safe to call from an effect.
  const load = useCallback(async () => {
    try {
      const w = await data.whoami();
      setWho(w);
      if (w.telegram_user_id && w.coach_enabled) {
        const [st, b] = await Promise.all([data.loadSettings(w.telegram_user_id), data.loadBundle(w.telegram_user_id)]);
        setSettings(st);
        setBundle(b);
      }
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  /** Pull-to-refresh: show the spinner while loading. */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  useEffect(() => {
    // Fetching from Supabase (an external system); state is only set after the network call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') load(); });
    return () => sub.remove();
  }, [load]);

  const logWeight = useCallback(async (weight: number, day = today) => {
    if (!ownerId) return;
    setBundle((b) => b && {
      ...b,
      entries: [...b.entries.filter((e) => e.date !== day), { date: day, weight }].sort((a, z) => a.date.localeCompare(z.date)),
    });
    try { await data.saveWeight(ownerId, day, weight); } catch (e) { setError((e as Error).message); refresh(); }
  }, [ownerId, today, refresh]);

  const toggleCheck = useCallback(async (key: 'minimum_done' | 'lifted', value: boolean, day = today) => {
    if (!ownerId) return;
    setBundle((b) => {
      if (!b) return b;
      const cur: Check = b.checks.find((c) => c.day === day) ?? { day, minimum_done: false, lifted: false, workout_label: null };
      return { ...b, checks: [...b.checks.filter((c) => c.day !== day), { ...cur, [key]: value }] };
    });
    try { await data.saveCheck(ownerId, day, { [key]: value }); } catch (e) { setError((e as Error).message); refresh(); }
  }, [ownerId, today, refresh]);

  const value = useMemo(
    () => ({ who, settings, bundle, today, error, refreshing, refresh, logWeight, toggleCheck }),
    [who, settings, bundle, today, error, refreshing, refresh, logWeight, toggleCheck],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside AppDataProvider');
  return v;
}

/** The stats snapshot (weekly averages, streak, ladder…) computed by the shared module. */
export function useSnapshot() {
  const { bundle, settings, today } = useApp();
  return useMemo(
    () => (bundle && settings ? S.buildSnapshot({ entries: bundle.entries, checks: bundle.checks, settings, today }) : null),
    [bundle, settings, today],
  );
}
