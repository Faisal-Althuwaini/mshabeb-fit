import { useMemo, useState } from 'react';
import * as S from '../lib/stats';
import * as data from '../lib/data';
import type { Bundle } from '../lib/data';
import { ar, dateLabel } from '../lib/format';

/** Log or fix one of the last 7 days (weight + «أقل شي» + حديد). */
export default function DayEditor({ ownerId, bundle, today, initialDay, minimumAction, onClose, onSaved, toast }: {
  ownerId: number; bundle: Bundle; today: string; initialDay: string; minimumAction: string;
  onClose: () => void; onSaved: () => void; toast: (m: string) => void;
}) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => S.addDays(today, -(i + 1))), [today]);
  const [day, setDay] = useState(days.includes(initialDay) ? initialDay : days[0]);
  const entry = bundle.entries.find((e) => e.date === day);
  const check = bundle.checks.find((c) => c.day === day);
  const [text, setText] = useState('');
  const [min, setMin] = useState<boolean | null>(null);
  const [lift, setLift] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = (d: string) => { setDay(d); setText(''); setMin(null); setLift(null); };
  const minVal = min ?? !!check?.minimum_done;
  const liftVal = lift ?? !!check?.lifted;

  const save = async () => {
    setBusy(true);
    try {
      if (text.trim()) {
        const r = S.parseWeightInput(text);
        if (!r.ok) { toast(r.reason === 'range' ? 'الوزن لازم يكون بين ٤٠ و ٢٥٠' : 'اكتب الوزن رقم'); setBusy(false); return; }
        await data.saveWeight(ownerId, day, r.value);
      }
      if (min !== null || lift !== null) {
        await data.saveCheck(ownerId, day, { minimum_done: minVal, lifted: liftVal, ...(liftVal ? {} : { workout_label: null }) });
      }
      toast(`تم ✅ ${dateLabel(day, today)}`);
      onSaved();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet stack" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: 0 }}>يوم فات؟</h2>
        <div className="day-chips">
          {days.map((d) => (
            <button key={d} className={d === day ? 'on' : ''} onClick={() => pick(d)}>{dateLabel(d, today)}</button>
          ))}
        </div>
        <label className="field">
          <span>الوزن {entry ? `(المسجّل: ${ar(entry.weight)})` : ''}</span>
          <input className="input" type="text" inputMode="decimal" dir="ltr" placeholder={entry ? ar(entry.weight) : '١١١٫٨'} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <button className={`toggle ${minVal ? 'on' : ''}`} onClick={() => setMin(!minVal)}>
          <span className="tick">{minVal ? '✓' : ''}</span>
          <span><b>سويت أقل شي</b><span className="small muted">{minimumAction}</span></span>
        </button>
        <button className={`toggle ${liftVal ? 'on' : ''}`} onClick={() => setLift(!liftVal)}>
          <span className="tick">{liftVal ? '✓' : ''}</span>
          <span><b>تمرنت حديد</b></span>
        </button>
        <div className="grid2">
          <button className="btn accent" onClick={save} disabled={busy || (!text.trim() && min === null && lift === null)}>حفظ</button>
          <button className="btn ghost" onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}
