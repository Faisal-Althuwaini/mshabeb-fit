import { useEffect, useMemo, useState } from 'react';
import * as S from '../lib/stats';
import * as data from '../lib/data';
import type { Bundle } from '../lib/data';
import type { Settings, Subject } from '../lib/types';
import { ar, daysAr } from '../lib/format';
import WeekDots from '../components/WeekDots';
import { pendingCount } from '../lib/offline';

const COACH_TEMPLATES = [
  'لا تغيب مرتين. اليوم بس سوّ يومك الأدنى 💪',
  'المتوسط الأسبوعي أهم من رقم اليوم.',
  'اليوم الأدنى يكفي. ١٥ دقيقة وخلاص.',
];

export default function Today({ subject, settings, bundle, today, onChanged, toast }: {
  subject: Subject; settings: Settings; bundle: Bundle; today: string; onChanged: () => void; toast: (m: string) => void;
}) {
  const snap = useMemo(() => S.buildSnapshot({ entries: bundle.entries, checks: bundle.checks, settings, today }), [bundle, settings, today]);
  const check = bundle.checks.find((c) => c.day === today);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(snap.todayWeight == null);
  const [confirmJump, setConfirmJump] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [coachLine, setCoachLine] = useState<string | null>(null);
  const [pending, setPending] = useState(0);

  useEffect(() => { setEditing(snap.todayWeight == null); }, [snap.todayWeight]);
  useEffect(() => { data.latestCoachLine(subject.ownerId, today).then(setCoachLine).catch(() => undefined); }, [subject.ownerId, today]);
  useEffect(() => { pendingCount().then(setPending); }, [bundle]);

  const save = async (value: number, confirmed = false) => {
    if (!confirmed && snap.previousWeight != null && Math.abs(value - snap.previousWeight) > 3) {
      setConfirmJump(value);
      return;
    }
    setBusy(true);
    try {
      const r = await data.saveWeight(subject.ownerId, today, value);
      toast(r === 'queued' ? 'محفوظ على الجهاز، بيترفع أول ما يرجع النت' : `تم ✅ ${ar(value)}`);
      setText('');
      setConfirmJump(null);
      onChanged();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = S.parseWeightInput(text);
    if (!r.ok) return toast(r.reason === 'range' ? 'الوزن لازم يكون بين ٤٠ و ٢٥٠' : 'اكتب الوزن رقم، مثل ١١٢٫٤');
    save(r.value);
  };

  const toggle = async (patch: { minimum_done?: boolean; lifted?: boolean; workout_label?: string | null }) => {
    try {
      const r = await data.saveCheck(subject.ownerId, today, patch);
      if (r === 'queued') toast('محفوظ على الجهاز');
      onChanged();
    } catch (e) { toast((e as Error).message); }
  };

  const yesterdayMissed = !snap.activeYesterday && (snap.missedDays == null || snap.missedDays >= 1) && bundle.entries.length > 0;
  const comeback = snap.missedDays != null && snap.missedDays >= 3;
  const line = coachLine || COACH_TEMPLATES[S.dayOfWeek(today) % COACH_TEMPLATES.length];

  return (
    <div>
      {settings.paused_until && settings.paused_until >= today && (
        <div className="banner ok">⏸️ التذكيرات موقفة لين {settings.paused_until}. سجّل عادي إذا تبي.</div>
      )}
      {comeback ? (
        <div className="banner">هلا والله 👋 الغياب يصير. {snap.totalLost != null && snap.totalLost > 0 ? `قبل كنت نازل ${ar(snap.totalLost)} كيلو، يعني تقدر. ` : ''}اليوم بس سوّ يومك الأدنى.</div>
      ) : yesterdayMissed && !snap.activeToday ? (
        <div className="banner">أمس فات؟ عادي. المهم لا تفوّت اليوم.</div>
      ) : null}
      {pending > 0 && <div className="banner ok">📶 {ar(pending, 0)} تسجيل ينتظر النت</div>}

      <div className="card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>وزن اليوم</h2>
          <span className="chip accent">🔥 {snap.streak ? daysAr(snap.streak) : 'ابدأ اليوم'}</span>
        </div>
        {!editing && snap.todayWeight != null ? (
          <div className="row between" style={{ marginTop: 12 }}>
            <div className="big-num">{ar(snap.todayWeight)}</div>
            <button className="btn ghost" onClick={() => setEditing(true)}>تعديل</button>
          </div>
        ) : confirmJump != null ? (
          <div className="stack" style={{ marginTop: 12 }}>
            <p style={{ margin: 0 }}>متأكد؟ <b>{ar(confirmJump)}</b> يختلف أكثر من ٣ كيلو عن آخر وزن ({ar(snap.previousWeight)}).</p>
            <div className="grid2">
              <button className="btn accent" onClick={() => save(confirmJump, true)} disabled={busy}>إيه، احفظه</button>
              <button className="btn ghost" onClick={() => setConfirmJump(null)}>لا، غلطت</button>
            </div>
          </div>
        ) : (
          <form className="stack" onSubmit={submit} style={{ marginTop: 12 }}>
            <input
              className="input weight-input" type="text" inputMode="decimal" autoComplete="off" dir="ltr"
              placeholder={snap.previousWeight != null ? ar(snap.previousWeight) : '١١٢٫٤'}
              value={text} onChange={(e) => setText(e.target.value)} aria-label="وزن اليوم بالكيلو"
            />
            <button className="btn accent block" disabled={busy || !text.trim()}>حفظ</button>
          </form>
        )}
        <p className="small muted" style={{ marginBottom: 0 }}>
          متوسط الأسبوع لين الحين: <b>{ar(snap.thisWeek.avg_weight)}</b>
          {snap.lastWeek.avg_weight != null && <> (الأسبوع اللي فات {ar(snap.lastWeek.avg_weight)})</>}
        </p>
      </div>

      <div className="stack" style={{ marginBottom: 12 }}>
        <button className={`toggle ${check?.minimum_done ? 'on' : ''}`} onClick={() => toggle({ minimum_done: !check?.minimum_done })} aria-pressed={!!check?.minimum_done}>
          <span className="tick">{check?.minimum_done ? '✓' : ''}</span>
          <span><b>سويت يومي الأدنى</b><span className="small muted">{settings.minimum_action}</span></span>
        </button>
        <div>
          <button className={`toggle ${check?.lifted ? 'on' : ''}`} onClick={() => toggle({ lifted: !check?.lifted, ...(check?.lifted ? { workout_label: null } : {}) })} aria-pressed={!!check?.lifted}>
            <span className="tick">{check?.lifted ? '✓' : ''}</span>
            <span><b>تمرنت حديد</b><span className="small muted">الأساس {ar(settings.lifting_days_required, 0)} أيام بالأسبوع</span></span>
          </button>
          {check?.lifted && (
            <div className="seg">
              {(['anterior', 'posterior'] as const).map((l) => (
                <button key={l} className={check.workout_label === l ? 'on' : ''} onClick={() => toggle({ lifted: true, workout_label: check.workout_label === l ? null : l })}>
                  {l === 'anterior' ? 'أمامي' : 'خلفي'}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <WeekDots bundle={bundle} today={today} weekStartDow={settings.week_start_dow} liftingRequired={settings.lifting_days_required} />

      <div className="card soft row" style={{ alignItems: 'flex-start' }}>
        <img className="avatar" src="/icons/mushabbab-avatar.jpg" alt="" style={{ width: 32, height: 32 }} />
        <p style={{ margin: 0 }}>{line}</p>
      </div>
    </div>
  );
}
