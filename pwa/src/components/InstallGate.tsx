import { useEffect, useState } from 'react';
import { canPrompt, onPromptChange, platform, promptInstall, skip } from '../lib/install';

/** iOS share icon (square with an arrow up), drawn inline so it matches what Safari shows. */
const ShareIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="مشاركة" style={{ verticalAlign: '-4px' }}>
    <path d="M12 3v12" /><path d="M8 7l4-4 4 4" /><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
  </svg>
);
const AddIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-label="إضافة" style={{ verticalAlign: '-4px' }}>
    <rect x="3" y="3" width="18" height="18" rx="4" /><path d="M12 8v8M8 12h8" />
  </svg>
);

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="install-step">
      <span className="install-num">{n.toLocaleString('ar-SA')}</span>
      <span>{children}</span>
    </li>
  );
}

/** Shown before sign-up when the site isn't running from the home screen (D30). */
export default function InstallGate({ onSkip }: { onSkip: () => void }) {
  const p = platform();
  const [prompt, setPrompt] = useState(canPrompt());
  const [copied, setCopied] = useState(false);
  useEffect(() => onPromptChange(() => setPrompt(canPrompt())), []);

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(location.origin); setCopied(true); } catch { /* ignore */ }
  };

  return (
    <div className="auth">
      <img className="hero" src="/icons/mushabbab-avatar.jpg" alt="مشبب" />
      <h1>ثبّت مشبب أول 📲</h1>
      <p className="muted center" style={{ marginTop: 0 }}>
        مشبب تطبيق تحطه على شاشتك الرئيسية. كذا توصلك التذكيرات، ويفتح بسرعة مثل أي تطبيق.
      </p>

      <div className="card">
        {p === 'ios-safari' && (
          <ol className="install-steps">
            <Step n={1}>اضغط زر المشاركة <ShareIcon /> تحت في Safari (أو فوق في الآيباد).</Step>
            <Step n={2}>انزل واختر <b>إضافة إلى الشاشة الرئيسية</b> <AddIcon /> (Add to Home Screen).</Step>
            <Step n={3}>اضغط <b>إضافة</b>، وافتح مشبب من أيقونته في شاشتك.</Step>
          </ol>
        )}
        {p === 'ios-other' && (
          <ol className="install-steps">
            <Step n={1}>اضغط زر المشاركة <ShareIcon /> (في Chrome تلقاه فوق جنب الرابط).</Step>
            <Step n={2}>اختر <b>إضافة إلى الشاشة الرئيسية</b> <AddIcon />.</Step>
            <Step n={3}>ما لقيته؟ انسخ الرابط وافتحه في <b>Safari</b> وسوّ نفس الخطوات.</Step>
          </ol>
        )}
        {p === 'in-app' && (
          <ol className="install-steps">
            <Step n={1}>أنت فاتحه من داخل تطبيق ثاني، وهنا ما ينفع تثبّته.</Step>
            <Step n={2}>اضغط <b>⋯</b> فوق واختر <b>فتح في المتصفح</b> (Safari أو Chrome)، أو انسخ الرابط وافتحه هناك.</Step>
          </ol>
        )}
        {p === 'android' && (
          prompt ? (
            <button className="btn accent block" onClick={() => promptInstall()}>ثبّت مشبب</button>
          ) : (
            <ol className="install-steps">
              <Step n={1}>اضغط <b>⋮</b> فوق في Chrome.</Step>
              <Step n={2}>اختر <b>تثبيت التطبيق</b> أو <b>إضافة إلى الشاشة الرئيسية</b>.</Step>
              <Step n={3}>افتح مشبب من أيقونته في شاشتك.</Step>
            </ol>
          )
        )}
        {p === 'desktop' && (
          <>
            <p style={{ marginTop: 0 }}>مشبب مصمم للجوال. افتح الرابط من جوالك وثبّته هناك:</p>
            <div className="code" dir="ltr" style={{ fontSize: 15, letterSpacing: 0 }}>{location.host}</div>
            {prompt && <button className="btn ghost block" style={{ marginTop: 12 }} onClick={() => promptInstall()}>أو ثبّته على هالجهاز</button>}
          </>
        )}
        {(p === 'in-app' || p === 'ios-other' || p === 'desktop') && (
          <button className="btn ghost block" style={{ marginTop: 12 }} onClick={copyLink}>{copied ? 'نسخت الرابط ✅' : 'نسخ الرابط'}</button>
        )}
      </div>

      <p className="small faint center">إذا ثبّته وفتحته من الأيقونة، بيطلع لك التسجيل على طول.</p>
      {(p === 'desktop' || p === 'android') && (
        <button className="link-btn faint small" style={{ display: 'block', margin: '8px auto' }} onClick={() => { skip(); onSkip(); }}>
          أكمل من المتصفح
        </button>
      )}
    </div>
  );
}
