import { useEffect, useState } from 'react';
import { disablePush, enablePush, getPushState, isIOS, type PushState } from '../lib/push';

/** «فعّل التنبيهات» — or the Add to Home Screen guide on iPhone Safari (plan §7.2). */
export default function PushCard({ authUserId, toast, hideWhenOn = false }: { authUserId: string; toast: (m: string) => void; hideWhenOn?: boolean }) {
  const [state, setState] = useState<PushState | null>(null);
  useEffect(() => { getPushState().then(setState).catch(() => setState('unsupported')); }, []);
  if (!state) return null;

  if (state === 'needs-install') {
    return (
      <div className="card soft">
        <h2>🔔 التنبيهات</h2>
        <p className="muted" style={{ marginTop: 0 }}>عشان توصلك التنبيهات على الآيفون، لازم تضيف التطبيق للشاشة الرئيسية:</p>
        <ol className="muted" style={{ paddingInlineStart: 20, margin: 0 }}>
          <li>اضغط زر المشاركة <b>⎋</b> تحت في سفاري</li>
          <li>اختر <b>«إضافة إلى الشاشة الرئيسية»</b></li>
          <li>افتح «مشبب» من الشاشة الرئيسية، وارجع هنا</li>
        </ol>
      </div>
    );
  }
  if (state === 'unsupported') return <div className="card soft"><h2>🔔 التنبيهات</h2><p className="muted" style={{ margin: 0 }}>هالمتصفح ما يدعم التنبيهات{isIOS() ? ' (يحتاج iOS ‎16.4 أو أحدث)' : ''}.</p></div>;
  if (state === 'denied') return <div className="card soft"><h2>🔔 التنبيهات</h2><p className="muted" style={{ margin: 0 }}>التنبيهات مقفلة. فعّلها من الإعدادات ← التنبيهات ← مشبب.</p></div>;

  const on = state === 'on';
  if (on && hideWhenOn) return null; // feed: once enabled, it lives in Settings only
  return (
    <div className="card soft row between">
      <div>
        <b>🔔 التنبيهات</b>
        <div className="small muted">{on ? 'شغّالة على هالجهاز' : 'التعليقات والتفاعلات توصلك كتنبيه'}</div>
      </div>
      <button
        className={`btn ${on ? 'ghost' : 'accent'}`}
        onClick={async () => {
          try { setState(on ? await disablePush() : await enablePush(authUserId)); toast(on ? 'وقفت التنبيهات' : 'تم ✅ التنبيهات شغّالة'); }
          catch (e) { toast((e as Error).message); }
        }}
      >
        {on ? 'إيقاف' : 'فعّل التنبيهات'}
      </button>
    </div>
  );
}
