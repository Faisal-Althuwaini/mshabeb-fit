import { useState } from 'react';
import * as data from '../lib/data';
import type { Bundle } from '../lib/data';
import type { Settings } from '../lib/types';
import * as S from '../lib/stats';
import { timeAgo } from '../lib/format';


/** Settings → «الخطوات والنوم»: Google Health link (D28), step goal, and the Apple Health Shortcut for Hevy (D27). */
export default function HealthCard({ settings, bundle, onSaved, toast }: {
  settings: Settings; bundle: Bundle; onSaved: () => Promise<void>; toast: (m: string) => void;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [goal, setGoal] = useState(String(settings.steps_goal ?? 6000));
  const [busy, setBusy] = useState(false);
  const connected = !!bundle.health?.connected;
  const google = bundle.google;
  const [syncing, setSyncing] = useState(false);
  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await data.syncGoogleHealth();
      await onSaved();
      toast(r.ok ? 'تم ✅ تحدّثت الخطوات والنوم' : `ما زبطت المزامنة: ${r.error ?? ''}`);
    } finally { setSyncing(false); }
  };
  const last = bundle.health?.last_used_at;

  const copy = async (s: string, what: string) => {
    try { await navigator.clipboard.writeText(s); toast(`نسخت ${what} ✅`); } catch { toast('ما قدرت أنسخ، انسخه يدوي'); }
  };
  const make = async () => {
    if (connected && !confirm('بيتغير المفتاح، والاختصار القديم يوقف لين تحط الجديد. أكمل؟')) return;
    setBusy(true);
    try { setToken(await data.createHealthToken()); await onSaved(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const saveGoal = async () => {
    const n = parseInt(S.normalizeDigits(goal).replace(/\D/g, ''), 10);
    if (!(n >= 1000 && n <= 50000)) return toast('الهدف بين ١٠٠٠ و ٥٠٠٠٠ خطوة');
    try { await data.saveSettings(settings.user_id, { steps_goal: n }); await onSaved(); toast('تم ✅'); } catch (e) { toast((e as Error).message); }
  };

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>⌚ الخطوات والنوم</h2>
      <p className="small muted" style={{ margin: 0 }}>
        اربط Google Health (ساعة Fitbit) وتوصل خطواتك ونومك لمشبب تلقائياً كل ٢٠ دقيقة.
        إذا وصلت هدف الخطوات ينعلّم «أقل شي ✅» لحاله.
      </p>
      <div className="row between">
        <span className="small">
          {!google ? '❌ Google Health مو مربوط'
            : google.last_error ? `⚠️ آخر مزامنة ما زبطت${google.last_sync_at ? ` (آخر نجاح ${timeAgo(google.last_sync_at)})` : ''}`
            : google.last_sync_at ? `✅ آخر مزامنة ${timeAgo(google.last_sync_at)}` : '⏳ مربوط، بانتظار أول مزامنة'}
        </span>
        {google
          ? <button className="btn ghost" style={{ minHeight: 38 }} onClick={syncNow} disabled={syncing}>{syncing ? '…' : 'مزامنة الحين'}</button>
          : <button className="btn accent" style={{ minHeight: 38 }} onClick={() => data.connectGoogleHealth().catch((e) => toast((e as Error).message))}>ربط Google Health</button>}
      </div>
      {google?.last_error && (
        <p className="small faint" dir="ltr" style={{ margin: 0, wordBreak: 'break-word' }}>{google.last_error}</p>
      )}
      {google?.last_error?.includes('invalid_grant') && (
        <button className="btn accent" onClick={() => data.connectGoogleHealth().catch((e) => toast((e as Error).message))}>أعد الربط</button>
      )}
      <label className="field">
        <span>هدف الخطوات اليومي</span>
        <div className="row">
          <input className="input" inputMode="numeric" dir="ltr" value={goal} onChange={(e) => setGoal(e.target.value)} />
          <button className="btn ghost" onClick={saveGoal}>حفظ</button>
        </div>
      </label>
      {google && <button className="link-btn faint small" onClick={async () => { if (confirm('توقف ربط Google Health؟')) { await data.disconnectGoogleHealth(); await onSaved(); } }}>إلغاء ربط Google Health</button>}
      <details className="box">
        <summary>🍎 اختصار Apple Health (لتمارين Hevy)</summary>
        <div className="stack" style={{ marginTop: 10 }}>
        <p className="small muted" style={{ margin: 0 }}>Hevy ما يكتب في Google Health، فتمارين الحديد توصل عن طريق اختصار بالآيفون: إذا سجّلت تمرين اليوم ينعلّم «حديد ✅».</p>
      <div className="row between">
        <span className="small">{connected ? (last ? `✅ آخر مزامنة ${timeAgo(last)}` : '⏳ مربوط، بانتظار أول مزامنة') : '❌ مو مربوط'}</span>
        <button className="btn ghost" style={{ minHeight: 38 }} onClick={make} disabled={busy}>{connected ? 'مفتاح جديد' : 'اعطني المفتاح'}</button>
      </div>
      {token && (
        <div className="stack">
          <div className="banner ok small" style={{ margin: 0 }}>انسخ المفتاح الحين، ما راح يطلع لك مرة ثانية.</div>
          <div className="code" style={{ fontSize: 12, letterSpacing: 0, wordBreak: 'break-all' }}>{token}</div>
          <div className="grid2">
            <button className="btn accent" onClick={() => copy(token, 'المفتاح')}>نسخ المفتاح</button>
            <button className="btn ghost" onClick={() => copy(data.HEALTH_SYNC_URL, 'الرابط')}>نسخ الرابط</button>
          </div>
        </div>
      )}
        <p className="small" style={{ margin: 0 }}><b>📱 طريقة عمل الاختصار (دقيقتين)</b></p>
        <ol className="small" style={{ paddingInlineStart: 20, lineHeight: 1.9, margin: 0 }}>
          <li>تأكد إن <b>Hevy</b> يكتب في Apple Health (Health ← صورتك ← Apps ← Hevy).</li>
          <li><b>Shortcuts</b> ← <b>+</b> ← <b>Find Health Samples</b> ← Type: <b>Active Energy</b> ← Start Date <b>is today</b> ← فلتر <b>Source is Hevy</b>. بعدها <b>Count</b>.</li>
          <li><b>Get Contents of URL</b>: الرابط اللي نسخته، Method <b>POST</b>، Header <code dir="ltr">Authorization</code> = <code dir="ltr">Bearer مفتاحك</code>، وBody <b>JSON</b> فيه خانة وحدة (Number): <code dir="ltr">workouts</code> = Count.</li>
          <li><b>Automation</b> ← <b>Time of Day</b> ← ٨ بالليل و١١ بالليل ← <b>Run Immediately</b>.</li>
        </ol>
        <p className="small faint" style={{ margin: 0 }}>الأرقام بالعربي أو بالدقائق أو الثواني كلها تنقبل. والاختصار يقدر يرسل لأمس بإضافة <code dir="ltr">date</code>.</p>
      {connected && <button className="link-btn faint small" onClick={async () => { if (confirm('توقف الربط؟')) { await data.revokeHealthToken(); await onSaved(); } }}>إلغاء الربط</button>}
        </div>
      </details>
    </div>
  );
}
