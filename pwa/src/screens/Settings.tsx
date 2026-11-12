import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import * as data from '../lib/data';
import type { Bundle } from '../lib/data';
import * as S from '../lib/stats';
import type { Settings, Subject, Watcher, WhoAmI } from '../lib/types';
import PushCard from '../components/PushCard';
import { getTheme, setTheme, type Theme } from '../lib/theme';

const DOW = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const hhmm = (t: string | null | undefined) => (t || '').slice(0, 5);

export default function SettingsScreen({ subject, settings, bundle, me, who, onSaved, toast }: {
  subject: Subject; settings: Settings | null; bundle: Bundle; me: User; who: WhoAmI; onSaved: () => Promise<void>; toast: (m: string) => void;
}) {
  return (
    <div>
      <h2 style={{ fontSize: 22, margin: '0 0 12px' }}>الإعدادات</h2>
      <NameCard
        initial={subject.isOwner ? (settings?.display_name ?? who.first_name ?? '') : (who.my_watcher_name ?? '')}
        hint={subject.isOwner ? 'يطلع لصاحبك في المتابعة والتنبيهات.' : `يطلع لـ${subject.name} على تعليقاتك وتفاعلاتك.`}
        onSave={async (name) => {
          if (subject.isOwner) await data.saveSettings(subject.ownerId, { display_name: name });
          else await data.setWatcherName(name);
          await onSaved();
        }}
        toast={toast}
      />
      <PushCard authUserId={me.id} toast={toast} />
      <Appearance />
      {subject.isOwner && settings ? (
        <>
          <CoachForm settings={settings} onSaved={onSaved} toast={toast} />
          <Watchers ownerId={subject.ownerId} toast={toast} />
          <div className="card">
            <h2>تيليجرام</h2>
            <p className="muted" style={{ margin: 0 }}>✅ مربوط بمشبب. اللي تسجله هنا يطلع هناك، والعكس.</p>
          </div>
          <div className="card">
            <h2>بياناتك</h2>
            <button className="btn ghost block" onClick={() => {
              const blob = new Blob(['﻿' + data.toCsv(bundle.entries, bundle.checks)], { type: 'text/csv;charset=utf-8' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `mushabbab-${S.localDate()}.csv`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            }}>تصدير CSV</button>
          </div>
        </>
      ) : (
        <div className="card">
          <h2>المتابعة</h2>
          <p className="muted" style={{ marginTop: 0 }}>تتابع {subject.name}. تشوف وزنه اليومي، المتوسط، السلّم، المشي والحديد، والوجبات، والفليكس اللي يشاركه.</p>
          <button className="btn ghost block" onClick={async () => {
            if (!confirm(`توقف متابعة ${subject.name}؟`)) return;
            try { await data.stopWatching(subject.ownerId, me.id); await onSaved(); } catch (e) { toast((e as Error).message); }
          }}>إيقاف المتابعة</button>
        </div>
      )}
      <div className="card">
        <p className="small muted" style={{ marginTop: 0 }}>{me.email}</p>
        <button className="btn ghost block" onClick={() => supabase.auth.signOut()}>تسجيل خروج</button>
      </div>
    </div>
  );
}

function CoachForm({ settings, onSaved, toast }: { settings: Settings; onSaved: () => Promise<void>; toast: (m: string) => void }) {
  const [f, setF] = useState(() => ({
    start_weight: String(settings.start_weight ?? ''),
    goal_weight: String(settings.goal_weight ?? ''),
    target_loss_per_4w: String(settings.target_loss_per_4w ?? 3),
    ladder_step: String(settings.ladder_step ?? 2),
    minimum_action: settings.minimum_action,
    lifting_days_required: String(settings.lifting_days_required ?? 2),
    morning_check_time: hhmm(settings.morning_check_time),
    evening_check_time: hhmm(settings.evening_check_time),
    weekly_report_dow: String(settings.weekly_report_dow ?? 6),
    weekly_report_time: hhmm(settings.weekly_report_time),
    paused_until: settings.paused_until || '',
  }));
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = (v: string) => { const r = S.parseWeightInput(v); return r.ok ? r.value : null; };
    const start = num(f.start_weight), goal = num(f.goal_weight);
    const per4 = Number(S.normalizeDigits(f.target_loss_per_4w));
    const step = Number(S.normalizeDigits(f.ladder_step));
    if (start == null || goal == null || goal >= start) return toast('البداية والهدف لازم يكونون أرقام، والهدف أقل');
    if (!(per4 > 0 && per4 <= 8)) return toast('الهدف كل ٤ أسابيع بين ٠٫٥ و ٨');
    if (!(step >= 0.5 && step <= 10)) return toast('درجة السلّم بين ٠٫٥ و ١٠');
    if (!f.minimum_action.trim()) return toast('اكتب وش أقل شي تسويه');
    setBusy(true);
    try {
      await data.saveSettings(settings.user_id, {
        start_weight: start, goal_weight: goal, target_loss_per_4w: per4, ladder_step: step,
        minimum_action: f.minimum_action.trim().slice(0, 60),
        lifting_days_required: Math.max(0, Math.min(7, parseInt(S.normalizeDigits(f.lifting_days_required), 10) || 2)),
        morning_check_time: f.morning_check_time, evening_check_time: f.evening_check_time,
        weekly_report_dow: Number(f.weekly_report_dow), weekly_report_time: f.weekly_report_time,
        paused_until: f.paused_until || null,
      });
      await onSaved();
      toast('تم الحفظ ✅');
    } catch (err) { toast((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <form className="card stack" onSubmit={save}>
      <h2 style={{ margin: 0 }}>المدرب</h2>
      <div className="grid2">
        <label className="field"><span>وزن البداية</span><input className="input" inputMode="decimal" dir="ltr" value={f.start_weight} onChange={set('start_weight')} /></label>
        <label className="field"><span>الهدف</span><input className="input" inputMode="decimal" dir="ltr" value={f.goal_weight} onChange={set('goal_weight')} /></label>
        <label className="field"><span>كيلو كل ٤ أسابيع</span><input className="input" inputMode="decimal" dir="ltr" value={f.target_loss_per_4w} onChange={set('target_loss_per_4w')} /></label>
        <label className="field"><span>درجة السلّم (كيلو)</span><input className="input" inputMode="decimal" dir="ltr" value={f.ladder_step} onChange={set('ladder_step')} /></label>
      </div>
      <label className="field"><span>أقل شي تسويه باليوم</span><input className="input" value={f.minimum_action} onChange={set('minimum_action')} maxLength={60} /></label>
      <label className="field"><span>أيام الحديد المطلوبة بالأسبوع</span><input className="input" inputMode="numeric" dir="ltr" value={f.lifting_days_required} onChange={set('lifting_days_required')} /></label>
      <div className="grid2">
        <label className="field"><span>تذكير الصباح</span><input className="input" type="time" value={f.morning_check_time} onChange={set('morning_check_time')} /></label>
        <label className="field"><span>تذكير المساء</span><input className="input" type="time" value={f.evening_check_time} onChange={set('evening_check_time')} /></label>
        <label className="field"><span>يوم التقرير</span>
          <select className="input" value={f.weekly_report_dow} onChange={set('weekly_report_dow')}>{DOW.map((d, i) => <option key={i} value={i}>{d}</option>)}</select>
        </label>
        <label className="field"><span>وقت التقرير</span><input className="input" type="time" value={f.weekly_report_time} onChange={set('weekly_report_time')} /></label>
      </div>
      <label className="field"><span>إيقاف التذكيرات لين (سفر / مرض)</span><input className="input" type="date" value={f.paused_until} onChange={set('paused_until')} /></label>
      <p className="small faint" style={{ margin: 0 }}>أوقات التذكير والتقرير تشتغل مع التذكيرات الذكية (المرحلة الجاية).</p>
      <button className="btn accent block" disabled={busy}>حفظ</button>
    </form>
  );
}

function Watchers({ ownerId, toast }: { ownerId: number; toast: (m: string) => void }) {
  const [list, setList] = useState<Watcher[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const load = () => data.listWatchers(ownerId).then(setList).catch((e) => toast(e.message));
  useEffect(() => { load(); }, [ownerId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>👀 اللي يتابعونك</h2>
      {list.length > 0 && <p className="small muted" style={{ margin: 0 }}>إذا طردت أحد، يوقف يشوف كل شي فوراً. يرجع بس إذا عطيته كود جديد.</p>}
      {list.length === 0 && <p className="muted" style={{ margin: 0 }}>ما أحد يتابعك للحين. ادعُ صاحبك عشان يشوف وزنك ووجباتك ويعلّق.</p>}
      {list.map((w) => (
        <div key={w.watcher_auth_user_id} className="row between" style={{ minHeight: 48 }}>
          <span><b>{w.display_name || 'صاحبك'}</b> <span className="small faint">· من {S.toArabicDigits(Number(w.created_at.slice(8, 10)), 0)}/{S.toArabicDigits(Number(w.created_at.slice(5, 7)), 0)}</span></span>
          <button className="btn ghost" style={{ color: 'var(--danger)', minHeight: 40 }} onClick={async () => {
            if (!confirm(`تطرد ${w.display_name || 'صاحبك'}؟ بيوقف يشوف وزنك ووجباتك فوراً.`)) return;
            try { await data.removeWatcher(ownerId, w.watcher_auth_user_id); toast('تم الطرد'); load(); } catch (e) { toast((e as Error).message); }
          }}>طرد</button>
        </div>
      ))}
      {code ? (
        <>
          <div className="code">{code}</div>
          <p className="small muted" style={{ margin: 0 }}>خل صاحبك يفتح التطبيق، ينشئ حساب، ويدخل هالكود. صالح ٢٤ ساعة.</p>
          {typeof navigator.share === 'function' && (
            <button className="btn ghost block" onClick={() => navigator.share({ text: `تابعني في مشبب 👀\n${location.origin}\nكود الدعوة: ${code}` }).catch(() => undefined)}>أرسل الدعوة</button>
          )}
        </>
      ) : (
        <button className="btn block" onClick={async () => { try { setCode(await data.createWatchInvite()); } catch (e) { toast((e as Error).message); } }}>ادعُ صاحب</button>
      )}
    </div>
  );
}

function Appearance() {
  const [t, setT] = useState<Theme>(getTheme());
  const pick = (v: Theme) => { setTheme(v); setT(v); };
  return (
    <div className="card">
      <h2>المظهر</h2>
      <div className="seg" style={{ marginTop: 0 }}>
        {([['dark', 'داكن'], ['light', 'فاتح'], ['auto', 'تلقائي']] as [Theme, string][]).map(([v, label]) => (
          <button key={v} className={t === v ? 'on' : ''} onClick={() => pick(v)} aria-pressed={t === v}>{label}</button>
        ))}
      </div>
    </div>
  );
}

function NameCard({ initial, hint, onSave, toast }: { initial: string; hint: string; onSave: (name: string) => Promise<void>; toast: (m: string) => void }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(initial), [initial]);
  const changed = name.trim() !== initial.trim();
  return (
    <form className="card stack" onSubmit={async (e) => {
      e.preventDefault();
      const n = name.trim();
      if (n.length < 1 || n.length > 40) return toast('الاسم من ١ إلى ٤٠ حرف');
      setBusy(true);
      try { await onSave(n); toast('تم ✅'); } catch (err) { toast((err as Error).message); } finally { setBusy(false); }
    }}>
      <label className="field">
        <span>اسمك</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="مثلاً: فيصل" />
      </label>
      <p className="small muted" style={{ margin: 0 }}>{hint}</p>
      {changed && <button className="btn accent block" disabled={busy}>حفظ الاسم</button>}
    </form>
  );
}
