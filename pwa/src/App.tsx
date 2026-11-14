import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, requestPersistentStorage } from './lib/supabase';
import * as data from './lib/data';
import type { Bundle } from './lib/data';
import { flushQueue } from './lib/offline';
import { unreadCount } from './lib/feed';
import type { Settings, Subject, WhoAmI } from './lib/types';
import * as S from './lib/stats';
import Auth from './screens/Auth';
import Setup from './screens/Setup';
import Today from './screens/Today';
import Progress from './screens/Progress';
import Feed from './screens/Feed';
import Flex from './screens/Flex';
import SettingsScreen from './screens/Settings';
import Coach from './screens/Coach';
import TabBar, { type Tab } from './components/TabBar';
import Header from './components/Header';
import { Toast, useToast } from './components/Toast';
import { demoData } from './lib/demo';

const DEMO = import.meta.env.DEV ? (new URLSearchParams(location.search).get('demo') as 'owner' | 'watcher' | null) : null;

const PATHS: Record<Tab, string> = { today: '/', progress: '/progress', coach: '/coach', feed: '/feed', flex: '/flex', settings: '/settings' };
const tabFromPath = (p: string): Tab =>
  (Object.entries(PATHS).find(([, v]) => v !== '/' && p.startsWith(v))?.[0] as Tab) || 'today';

const SEEN_KEY = 'feed-seen-at';
const readSeen = () => { try { return localStorage.getItem(SEEN_KEY); } catch { return null; } };
const writeSeen = () => { try { localStorage.setItem(SEEN_KEY, new Date().toISOString()); } catch { /* ignore */ } };

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [who, setWho] = useState<WhoAmI | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [watchIdx, setWatchIdx] = useState(0);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [tab, setTab] = useState<Tab>(tabFromPath(location.pathname));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [seenAt, setSeenAt] = useState<string | null>(readSeen());
  const toast = useToast();

  // ── Auth ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (DEMO) {
      const d = demoData(S.localDate(), DEMO);
      setSession({ user: { id: DEMO === 'owner' ? 'me' : 'friend', email: 'demo@local' } } as unknown as Session);
      setWho(d.who); setSettings(DEMO === 'owner' ? d.settings : null); setBundle(d.bundle);
      return;
    }
    supabase.auth.getSession().then(({ data: d }) => setSession(d.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const refreshWho = useCallback(async () => {
    // Instant start: show what this device saw last time, then refresh from the server.
    const [cw] = await Promise.all([data.cachedWhoami()]);
    if (cw) {
      setWho((cur) => cur ?? cw);
      if (cw.telegram_user_id && cw.coach_enabled) {
        const cs = await data.cachedSettings(cw.telegram_user_id);
        if (cs) setSettings((cur) => cur ?? cs);
      }
    }
    try {
      setLoadError(null);
      const w = await data.whoami();
      setWho(w);
      if (w.telegram_user_id && w.coach_enabled) setSettings(await data.loadSettings(w.telegram_user_id));
      else setSettings(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (DEMO) return;
    if (session) requestPersistentStorage();
    if (session) refreshWho();
    else { setWho(null); setSettings(null); setBundle(null); }
  }, [session, refreshWho]);

  // ── Who are we looking at? ──────────────────────────────────────────────
  const subject: Subject | null = useMemo(() => {
    if (!who) return null;
    if (who.telegram_user_id && who.coach_enabled && settings) {
      return { ownerId: who.telegram_user_id, name: who.first_name || 'أنا', isOwner: true, settings };
    }
    const w = who.watching[Math.min(watchIdx, who.watching.length - 1)];
    if (w) return { ownerId: w.owner_user_id, name: w.first_name || 'صاحبك', isOwner: false, settings: w };
    return null;
  }, [who, settings, watchIdx]);

  // Paint the last cached bundle immediately when the subject changes.
  useEffect(() => {
    if (!subject || DEMO) return;
    let alive = true;
    data.cachedBundle(subject.ownerId).then((b) => { if (alive && b) setBundle((cur) => cur ?? b); });
    return () => { alive = false; };
  }, [subject?.ownerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => {
    if (!subject || DEMO) return;
    try {
      await flushQueue();
      setBundle(await data.loadBundle(subject.ownerId));
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [subject]);

  useEffect(() => { refresh(); }, [refresh]);

  // Instant UI: screens change the bundle locally right away (mutate), the server write runs in
  // the background, then one debounced refresh reconciles with the database (refreshSoon).
  const mutate = useCallback((fn: (b: Bundle) => Bundle) => setBundle((b) => (b ? fn(b) : b)), []);
  const soonTimer = useRef<number>();
  const refreshSoon = useCallback(() => {
    window.clearTimeout(soonTimer.current);
    soonTimer.current = window.setTimeout(() => { refresh(); }, 1500);
  }, [refresh]);
  useEffect(() => {
    const onFocus = () => document.visibilityState === 'visible' && refresh();
    const onOnline = () => refresh();
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('online', onOnline);
    const t = setInterval(refresh, 60_000);
    return () => { document.removeEventListener('visibilitychange', onFocus); window.removeEventListener('online', onOnline); clearInterval(t); };
  }, [refresh]);

  // ── Routing ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const onPop = () => setTab(tabFromPath(location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = (t: Tab) => {
    setTab(t);
    if (location.pathname !== PATHS[t]) history.pushState(null, '', PATHS[t]);
    window.scrollTo({ top: 0 });
  };
  // Watchers only have Feed + Progress (+ Settings).
  const watcherTab: Tab = tab === 'today' || tab === 'flex' || tab === 'coach' ? 'feed' : tab;
  const activeTab = subject && !subject.isOwner ? watcherTab : tab;

  useEffect(() => {
    if (activeTab === 'feed' && bundle) { writeSeen(); setSeenAt(readSeen()); }
  }, [activeTab, bundle]);

  // ── Render ──────────────────────────────────────────────────────────────
  if (session === undefined) return <div className="spinner" />;
  if (!session) return <Auth />;
  if (!who) {
    return (
      <div className="auth center">
        {loadError ? <><p className="error">{loadError}</p><button className="btn" onClick={refreshWho}>حاول مرة ثانية</button></> : <div className="spinner" />}
      </div>
    );
  }
  if (!subject) return <Setup who={who} me={session.user} onDone={refreshWho} toast={toast.show} />;

  const me = session.user.id;
  const today = S.localDate(new Date(), subject.settings.timezone || 'Asia/Riyadh');
  const unread = bundle && activeTab !== 'feed' ? unreadCount(bundle, me, seenAt) : 0;

  return (
    <div className="app">
      <main className="page">
        <Header
          subject={subject}
          watching={who.watching}
          watchIdx={watchIdx}
          onPickWatch={setWatchIdx}
          onSettings={() => go('settings')}
        />
        {loadError && !bundle && <p className="error">{loadError}</p>}
        {!bundle ? (
          <div className="spinner" />
        ) : activeTab === 'today' && subject.isOwner && settings ? (
          <Today subject={subject} settings={settings} bundle={bundle} today={today} onChanged={refreshSoon} mutate={mutate} toast={toast.show} />
        ) : activeTab === 'progress' ? (
          <Progress subject={subject} bundle={bundle} today={today} toast={toast.show} />
        ) : activeTab === 'coach' && subject.isOwner ? (
          <Coach subject={subject} today={today} toast={toast.show} />
        ) : activeTab === 'feed' ? (
          <Feed subject={subject} bundle={bundle} today={today} me={me} who={who} onChanged={refreshSoon} mutate={mutate} toast={toast.show} />
        ) : activeTab === 'flex' && subject.isOwner ? (
          <Flex subject={subject} bundle={bundle} today={today} onChanged={refreshSoon} mutate={mutate} toast={toast.show} />
        ) : activeTab === 'settings' ? (
          <SettingsScreen
            subject={subject}
            settings={settings}
            bundle={bundle}
            me={session.user}
            who={who}
            onSaved={async () => { await refreshWho(); await refresh(); }}
            toast={toast.show}
          />
        ) : null}
      </main>
      <TabBar tab={activeTab} isOwner={subject.isOwner} onTab={go} unread={unread} />
      <Toast msg={toast.msg} />
    </div>
  );
}
