import { useState } from 'react';
import { supabase } from '../lib/supabase';

/** Email + password (D13). Sign-up is for Faisal's first login and for invited watchers. */
export default function Auth() {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else if (mode === 'signup') {
        if (password.length < 8) throw new Error('كلمة المرور لازم تكون ٨ أحرف أو أكثر');
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        if (!data.session) setMsg({ kind: 'ok', text: 'تم إنشاء الحساب. إذا وصلك إيميل تأكيد، أكّده وبعدين سجّل دخول.' });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/` });
        if (error) throw error;
        setMsg({ kind: 'ok', text: 'أرسلنا لك رابط لتغيير كلمة المرور. افتحه، غيّرها، وارجع سجّل دخول هنا.' });
      }
    } catch (err) {
      const t = (err as Error).message;
      setMsg({ kind: 'error', text: /invalid login/i.test(t) ? 'الإيميل أو كلمة المرور غلط' : /already registered/i.test(t) ? 'الإيميل مسجّل. سجّل دخول.' : t });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <img className="hero" src="/icons/mushabbab-avatar.jpg" alt="مشبب" />
      <h1>مشبب</h1>
      <p className="muted center" style={{ marginTop: 0 }}>لا تغيب مرتين. أقل شي يكفي.</p>
      <form className="stack" onSubmit={submit} style={{ marginTop: 24 }}>
        <label className="field">
          <span>الإيميل</span>
          <input className="input" type="email" dir="ltr" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode !== 'reset' && (
          <label className="field">
            <span>كلمة المرور</span>
            <input className="input" type="password" dir="ltr" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={mode === 'signup' ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        )}
        {msg && <p className={msg.kind === 'error' ? 'error' : 'banner ok'} style={{ margin: 0 }}>{msg.text}</p>}
        <button className="btn accent block" disabled={busy}>
          {mode === 'login' ? 'دخول' : mode === 'signup' ? 'إنشاء حساب' : 'أرسل رابط التغيير'}
        </button>
      </form>
      <div className="center" style={{ marginTop: 16 }}>
        {mode === 'login' ? (
          <>
            <button className="link-btn" onClick={() => { setMode('signup'); setMsg(null); }}>ما عندك حساب؟ أنشئ واحد</button>
            <br />
            <button className="link-btn faint" onClick={() => { setMode('reset'); setMsg(null); }}>نسيت كلمة المرور</button>
          </>
        ) : (
          <button className="link-btn" onClick={() => { setMode('login'); setMsg(null); }}>عندك حساب؟ سجّل دخول</button>
        )}
      </div>
    </div>
  );
}
