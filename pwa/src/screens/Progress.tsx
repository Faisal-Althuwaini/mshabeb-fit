import { useMemo, useState } from 'react';
import * as S from '../lib/stats';
import type { Bundle } from '../lib/data';
import type { Subject } from '../lib/types';
import { targetLine } from '../lib/feed';
import { ar, arInt, daysAr } from '../lib/format';
import WeightChart from '../components/WeightChart';
import Ladder from '../components/Ladder';
import { MEASURE_FIELDS } from '../lib/types';

type Range = '4w' | '12w' | 'all';

export default function Progress({ subject, bundle, today }: { subject: Subject; bundle: Bundle; today: string }) {
  const [range, setRange] = useState<Range>('12w');
  const s = subject.settings;
  const snap = useMemo(
    () => S.buildSnapshot({ entries: bundle.entries, checks: bundle.checks, settings: { ...s, week_start_dow: s.week_start_dow ?? 0 }, today }),
    [bundle, s, today]
  );
  const first = bundle.entries[0]?.date ?? today;
  const fromDay = range === '4w' ? S.addDays(today, -27) : range === '12w' ? S.addDays(today, -83) : first;
  const target = useMemo(() => targetLine(s, today), [s, today]);
  const liftWeeks = snap.weekly.filter((w) => w.lifting_days >= (s.lifting_days_required ?? 2)).length;

  return (
    <div>
      <div className="card">
        <div className="row between" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{subject.isOwner ? 'وزنك' : `وزن ${subject.name}`}</h2>
          {snap.weekChange != null && <span className={`chip ${snap.weekChange <= 0 ? 'accent' : ''}`}>{S.formatDelta(snap.weekChange)} عن الأسبوع اللي فات</span>}
        </div>
        <div className="ranges" role="tablist">
          {(['4w', '12w', 'all'] as Range[]).map((r) => (
            <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)} role="tab" aria-selected={range === r}>
              {r === '4w' ? '٤ أسابيع' : r === '12w' ? '١٢ أسبوع' : 'الكل'}
            </button>
          ))}
        </div>
        <WeightChart entries={bundle.entries} weekly={snap.weekly} target={target} fromDay={fromDay} toDay={today} />
        <div className="legend">
          <span><i style={{ background: 'var(--ink-3)' }} />وزن يومي</span>
          <span><i style={{ background: 'var(--accent)' }} />متوسط الأسبوع</span>
          <span><i style={{ background: 'var(--ink-3)' }} />الهدف ({ar(s.target_loss_per_4w)} كيلو / ٤ أسابيع)</span>
        </div>
      </div>

      <div className="stats" style={{ marginBottom: 12 }}>
        <div className="stat"><b>{snap.totalLost != null ? ar(snap.totalLost) : '—'}</b><span>كيلو نزل</span></div>
        <div className="stat"><b>{arInt(snap.bestStreak)}</b><span>أطول سلسلة</span></div>
        <div className="stat"><b>{arInt(liftWeeks)}</b><span>أسابيع حديد ✓</span></div>
      </div>

      {bundle.measurements.length > 0 && (() => {
        const first = bundle.measurements[0];
        const last = bundle.measurements[bundle.measurements.length - 1];
        const rows = MEASURE_FIELDS.filter((f) => last[f.key] != null);
        return rows.length ? (
          <div className="card">
            <h2>📏 القياسات</h2>
            <div className="mchips">
              {rows.map((f) => {
                const d = first !== last && first[f.key] != null ? Math.round(((last[f.key] as number) - (first[f.key] as number)) * 10) / 10 : null;
                return <span key={f.key}>{f.label} <b>{ar(last[f.key])}</b> {f.unit}{d != null && d !== 0 && <span className={d < 0 ? 'down' : 'up'}> {S.formatDelta(d)}</span>}</span>;
              })}
            </div>
            {first !== last && <p className="small faint" style={{ marginBottom: 0 }}>الفرق من أول قياس ({first.day})</p>}
          </div>
        ) : null;
      })()}

      <div className="card">
        <h2>سلّم النزول</h2>
        <p className="small muted" style={{ marginTop: -6 }}>الدرجة تنحسب لما يكون متوسط أسبوع كامل (٣ وزنات أو أكثر) تحتها.</p>
        <Ladder ladder={snap.ladder} />
      </div>

      <div className="card soft small muted">
        السلسلة الحالية: {snap.streak ? daysAr(snap.streak) : '—'} · المتوسط الأسبوعي أهم من رقم اليوم.
      </div>
    </div>
  );
}
