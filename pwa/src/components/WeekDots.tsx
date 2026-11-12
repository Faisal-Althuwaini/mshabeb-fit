import type { Bundle } from '../lib/data';
import * as S from '../lib/stats';
import { arInt, dayShort } from '../lib/format';

export default function WeekDots({ bundle, today, weekStartDow, liftingRequired, onPickDay }: { bundle: Bundle; today: string; weekStartDow: number; liftingRequired: number; onPickDay?: (d: string) => void }) {
  const ws = S.weekStart(today, weekStartDow);
  const days = Array.from({ length: 7 }, (_, i) => S.addDays(ws, i));
  const weights = new Set(bundle.entries.map((e) => e.date));
  const checks = new Map(bundle.checks.map((c) => [c.day, c]));
  const lifting = days.filter((d) => checks.get(d)?.lifted).length;
  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>هالأسبوع</h2>
        <span className={`chip ${lifting >= liftingRequired ? 'accent' : ''}`}>🏋️ {arInt(lifting)}/{arInt(liftingRequired)}</span>
      </div>
      <div className="week">
        {days.map((d) => (
          <button key={d} className={`d ${d === today ? "today" : ""}`} disabled={!onPickDay || d >= today} onClick={() => onPickDay?.(d)} aria-label={`تعديل ${d}`}>
            {dayShort(d)}
            <div className="dots">
              <span className={`dot ${weights.has(d) ? 'w' : ''}`} />
              <span className={`dot ${checks.get(d)?.minimum_done ? 'm' : ''}`} />
              <span className={`dot ${checks.get(d)?.lifted ? 'l' : ''}`} />
            </div>
          </button>
        ))}
      </div>
      <div className="legend">
        <span><i style={{ background: 'var(--ink)' }} />وزن</span>
        <span><i style={{ background: 'var(--accent)' }} />أقل شي</span>
        <span><i style={{ background: 'var(--ok)' }} />حديد</span>
      </div>
    </div>
  );
}
