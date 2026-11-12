export type Tab = 'today' | 'progress' | 'coach' | 'feed' | 'flex' | 'settings';

const OWNER_TABS: { id: Tab; label: string; ico: string }[] = [
  { id: 'today', label: 'اليوم', ico: '☀️' },
  { id: 'progress', label: 'التقدم', ico: '📉' },
  { id: 'coach', label: 'المدرب', ico: '🧭' },
  { id: 'feed', label: 'المتابعة', ico: '👀' },
  { id: 'flex', label: 'فليكس', ico: '💪' },
];
const WATCHER_TABS = OWNER_TABS.filter((t) => t.id === 'feed' || t.id === 'progress').reverse();

export default function TabBar({ tab, isOwner, onTab, unread }: { tab: Tab; isOwner: boolean; onTab: (t: Tab) => void; unread: number }) {
  const tabs = isOwner ? OWNER_TABS : WATCHER_TABS;
  return (
    <nav className="tabbar" aria-label="التنقل">
      {tabs.map((t) => (
        <button key={t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => onTab(t.id)} aria-current={tab === t.id}>
          <span className="ico" aria-hidden>{t.ico}</span>
          {t.label}
          {t.id === 'feed' && unread > 0 && <span className="badge">{unread > 9 ? '٩+' : unread.toLocaleString('ar-SA')}</span>}
        </button>
      ))}
    </nav>
  );
}
