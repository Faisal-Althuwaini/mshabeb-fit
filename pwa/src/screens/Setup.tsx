import { useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import * as data from '../lib/data';
import * as S from '../lib/stats';
import type { WhoAmI } from '../lib/types';

/** First run: link Telegram (owner) or enter a watch invite (friend). */
export default function Setup({ who, me, onDone, toast }: { who: WhoAmI; me: User; onDone: () => void; toast: (m: string) => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [invite, setInvite] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const linked = !!who.telegram_user_id;

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

      {linked && !who.coach_enabled ? (
        <div className="card">
          <h2>فعّل المدرب أول</h2>
          <p className="muted" style={{ marginTop: 0 }}>حسابك مربوط بتيليجرام، بس المدرب مو شغّال. أرسل لمشبب:</p>
          <div className="code" style={{ fontSize: 22, letterSpacing: 1 }}>/coach 90</div>
          <button className="btn ghost block" style={{ marginTop: 12 }} onClick={onDone}>سويتها، حدّث</button>
        </div>
      ) : (
        <div className="card">
          <h2>🧭 أنا اللي أنزل وزني</h2>
          <p className="muted" style={{ marginTop: 0 }}>اربط التطبيق بمشبب في تيليجرام، عشان يكون كل شي في مكان واحد.</p>
          {code ? (
            <>
              <div className="code">{code}</div>
              <p className="muted small">أرسل لمشبب في تيليجرام: <b dir="ltr">/link {code}</b> (صالح ١٠ دقايق)</p>
              <button className="btn accent block" onClick={onDone}>أرسلته، كمّل</button>
            </>
          ) : (
            <button className="btn accent block" onClick={makeCode} disabled={busy}>اعطني كود الربط</button>
          )}
        </div>
      )}

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
