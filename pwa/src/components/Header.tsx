import type { Subject, WatchedOwner } from '../lib/types';

export default function Header({ subject, watching, watchIdx, onPickWatch, onSettings }: {
  subject: Subject; watching: WatchedOwner[]; watchIdx: number; onPickWatch: (i: number) => void; onSettings: () => void;
}) {
  return (
    <header className="header">
      <img className="avatar" src="/icons/mushabbab-avatar.jpg" alt="مشبب" />
      {subject.isOwner || watching.length < 2 ? (
        <h1>{subject.isOwner ? 'مشبب' : `تتابع ${subject.name}`}</h1>
      ) : (
        <select className="input" style={{ flex: 1 }} value={watchIdx} onChange={(e) => onPickWatch(Number(e.target.value))} aria-label="تتابع">
          {watching.map((w, i) => <option key={w.owner_user_id} value={i}>تتابع {w.first_name || 'صاحبك'}</option>)}
        </select>
      )}
      <button className="icon-btn" onClick={onSettings} aria-label="الإعدادات">⚙️</button>
    </header>
  );
}
