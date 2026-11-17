import { useState } from 'react';
import * as data from '../lib/data';
import type { Bundle } from '../lib/data';
import type { Settings } from '../lib/types';
import * as S from '../lib/stats';
import { timeAgo } from '../lib/format';


/** Settings → «ربط Apple Health» (D27): token, step goal, last sync, Shortcut guide. */
export default function HealthCard({ settings, bundle, onSaved, toast }: {
  settings: Settings; bundle: Bundle; onSaved: () => Promise<void>; toast: (m: string) => void;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [goal, setGoal] = useState(String(settings.steps_goal ?? 6000));
  const [busy, setBusy] = useState(false);
  const connected = !!bundle.health?.connected;
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
      <h2 style={{ margin: 0 }}>🍎 ربط Apple Health</h2>
      <p className="small muted" style={{ margin: 0 }}>
        الخطوات والنوم (من Fitbit عن طريق Google Health) وتمارين الحديد (من Hevy) توصل مشبب تلقائياً عن طريق اختصار بالآيفون.
        إذا وصلت هدف الخطوات ينعلّم «أقل شي ✅»، وإذا سجّلت تمرين في Hevy اليوم ينعلّم «حديد ✅».
      </p>
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
      <label className="field">
        <span>هدف الخطوات اليومي</span>
        <div className="row">
          <input className="input" inputMode="numeric" dir="ltr" value={goal} onChange={(e) => setGoal(e.target.value)} />
          <button className="btn ghost" onClick={saveGoal}>حفظ</button>
        </div>
      </label>
      <details className="box">
        <summary>📱 طريقة عمل الاختصار (٥ دقايق)</summary>
        <ol className="small" style={{ paddingInlineStart: 20, lineHeight: 1.9 }}>
          <li>تأكد إن <b>Google Health</b> و <b>Hevy</b> يكتبون في Apple Health (Health ← صورتك ← Apps).</li>
          <li>افتح تطبيق <b>Shortcuts</b> ← <b>+</b> اختصار جديد، سمّه «مشبب».</li>
          <li><b>الخطوات:</b> أضف <b>Find Health Samples</b> ← Type: <b>Steps</b> ← Start Date <b>is today</b>. (إذا فيه فلتر <b>Source</b> اختر Google Health عشان ما تنحسب خطوات الجوال مرتين.) بعدها <b>Calculate Statistics</b> ← <b>Sum</b>.</li>
          <li><b>الحديد (Hevy):</b> أضف <b>Find Health Samples</b> ← Type: <b>Active Energy</b> ← Start Date <b>is today</b> ← فلتر <b>Source is Hevy</b>. بعدها <b>Count</b>. إذا العدد أكثر من ٠ يعني تمرنت اليوم.</li>
          <li><b>النوم:</b> أضف <b>Find Health Samples</b> ← Type: <b>Sleep Analysis</b> ← Start Date <b>is in the last 1 day</b> ← Value <b>is not</b> In Bed / Awake. بعدها <b>Get Details</b> ← <b>Duration</b> ← <b>Sum</b>.</li>
          <li>أضف <b>Get Contents of URL</b>:
            <ul>
              <li>URL: الرابط اللي نسخته</li>
              <li>Method: <b>POST</b></li>
              <li>Headers: <code dir="ltr">Authorization</code> = <code dir="ltr">Bearer مفتاحك</code></li>
              <li>Request Body: <b>JSON</b> بثلاث خانات (Number): <code dir="ltr">steps</code> = مجموع الخطوات، <code dir="ltr">workouts</code> = عدد Hevy، <code dir="ltr">sleep_minutes</code> = مجموع النوم</li>
            </ul>
          </li>
          <li>شغّله مرة، ولازم تشوف «آخر مزامنة الحين» هنا ✅</li>
          <li><b>Automation</b> ← <b>Time of Day</b> ← ١ الظهر، ٦ المغرب، ١٠ بالليل ← <b>Run Immediately</b> ← اختصار «مشبب».</li>
        </ol>
        <p className="small faint" style={{ margin: 0 }}>الأرقام بالعربي أو بالدقائق أو الثواني كلها تنقبل. والاختصار يقدر يرسل لأمس بإضافة <code dir="ltr">date</code>.</p>
      </details>
      {connected && <button className="link-btn faint small" onClick={async () => { if (confirm('توقف الربط؟')) { await data.revokeHealthToken(); await onSaved(); } }}>إلغاء الربط</button>}
    </div>
  );
}
