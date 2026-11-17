import { useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import * as data from '../lib/data';
import * as S from '../lib/stats';
import type { WhoAmI } from '../lib/types';

const MINIMUMS = ['مشي ١٥ دقيقة', 'مشي ٣٠ دقيقة', '٥٠٠٠ خطوة', '١٠ دقايق تمارين'];

/** First run: start coaching in the app (D29), link the Telegram bot, or enter a watch invite (friend). */
export default function Setup({ who, me, onDone, toast }: { who: WhoAmI; me: User; onDone: () => void; toast: (m: string) => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [invite, setInvite] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const linked = !!who.telegram_user_id;
  const [myName, setMyName] = useState(who.first_name || '');
  const [startW, setStartW] = useState('');
  const [goalW, setGoalW] = useState('');
  const [minimum, setMinimum] = useState(MINIMUMS[0]);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = (v: string) => parseFloat(S.normalizeDigits(v).replace(/[^\d.]/g, ''));
    const sw = n(startW), gw = n(goalW);
    if (!myName.trim()) return toast('اكتب اسمك');
    if (!(sw >= 30 && sw <= 300)) return toast('اكتب وزنك الحين بالكيلو');
    if (!(gw >= 30 && gw < sw)) return toast('الهدف لازم يكون أقل من وزنك الحين');
    setBusy(true);
    try { await data.startCoach(myName.trim(), sw, gw, minimum); toast('هلا والله 💪 بدينا'); onDone(); }
    catch (err) { toast((err as Error).message); } finally { setBusy(false); }
  };

  const makeCode = async () => {
    setBusy(true);
    try { setCode(await data.createLinkCode()); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const accept = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = S.normalizeDigits(invite).replace(/\D/g, '');
    if (c.length !== 6) return toast('الكود ٦ أرقام');
    setBusy(true);
    try {
      const r = await data.acceptWatchInvite(c, name);
      const msgs = { ok: 'تم ✅ صرت تتابعه', invalid: 'الكود غلط', expired: 'الكود انتهى، اطلب كود جديد', self: 'هذا كودك أنت 😄' } as const;
      toast(msgs[r]);
      if (r === 'ok') onDone();
    } catch (err) { toast((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="auth">
      <img className="hero" src="/icons/mushabbab-avatar.jpg" alt="" />
      <h1>هلا 👋</h1>
      <p className="muted center" style={{ marginTop: 0 }}>{me.email}</p>

      <form className="card stack" onSubmit={start}>
        <h2 style={{ margin: 0 }}>🧭 أبي أنزل وزني</h2>
        <p className="muted small" style={{ margin: 0 }}>أربع أسئلة وتبدأ. تقدر تغيّرها بعدين من الإعدادات.</p>
        <label className="field"><span>اسمك</span>
          <input className="input" value={myName} onChange={(e) => setMyName(e.target.value)} maxLength={40} placeholder="فيصل" />
        </label>
        <div className="grid2">
          <label className="field"><span>وزنك الحين (كغ)</span>
            <input className="input" inputMode="decimal" dir="ltr" value={startW} onChange={(e) => setStartW(e.target.value)} placeholder="95" />
          </label>
          <label className="field"><span>هدفك (كغ)</span>
            <input className="input" inputMode="decimal" dir="ltr" value={goalW} onChange={(e) => setGoalW(e.target.value)} placeholder="80" />
          </label>
        </div>
        <div className="field">
          <span>«أقل شي» حقك: الحد الأدنى اللي تسويه حتى في أسوأ يوم</span>
          <div className="day-chips">
            {MINIMUMS.map((m) => (
              <button type="button" key={m} className={minimum === m ? 'on' : ''} onClick={() => setMinimum(m)}>{m}</button>
            ))}
          </div>
        </div>
        <button className="btn accent block" disabled={busy}>يلا نبدأ 💪</button>
        {!linked && (
          <details>
            <summary className="small faint">تستخدم بوت مشبب في تيليجرام؟ اربطه بدال</summary>
            <div className="stack" style={{ marginTop: 8 }}>
              {code ? (
                <>
                  <div className="code">{code}</div>
                  <p className="muted small" style={{ margin: 0 }}>أرسل للبوت: <b dir="ltr">/link {code}</b> (صالح ١٠ دقايق)</p>
                  <button type="button" className="btn ghost block" onClick={onDone}>أرسلته، كمّل</button>
                </>
              ) : (
                <button type="button" className="btn ghost block" onClick={makeCode} disabled={busy}>اعطني كود الربط</button>
              )}
            </div>
          </details>
        )}
      </form>

      <div className="card">
        <h2>👀 أنا جاي أتابع صاحبي</h2>
        <form className="stack" onSubmit={accept}>
          <label className="field"><span>اسمك (يشوفه صاحبك)</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></label>
          <label className="field"><span>كود الدعوة</span><input className="input" inputMode="numeric" dir="ltr" value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="123456" /></label>
          <button className="btn block" disabled={busy}>ابدأ المتابعة</button>
        </form>
      </div>

      <button className="link-btn faint" onClick={() => supabase.auth.signOut()}>تسجيل خروج</button>
    </div>
  );
}
