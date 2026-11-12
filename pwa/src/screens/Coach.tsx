import { useEffect, useMemo, useRef, useState } from 'react';
import * as data from '../lib/data';
import type { CoachMessage, Subject, WeeklyReport } from '../lib/types';
import { dateLabel, timeAgo } from '../lib/format';
import * as S from '../lib/stats';

const QUICK = ['وش أسوي اليوم؟', 'ليه وزني زاد هالأسبوع؟', 'أبي تحفيز 💪', 'عندي عزيمة الليلة، وش أسوي؟'];
const KIND_LABEL: Partial<Record<CoachMessage['kind'], string>> = {
  nudge_morning: '☀️ تذكير الصبح', nudge_firm: '💪 لا تغيب مرتين', comeback: '👋 رجعة', lifting_check: '🏋️ الحديد',
  weekly_report: '📊 تقرير الأسبوع', trend_alert: '⚠️ تنبيه بدري', milestone: '🎉 درجة جديدة',
};

/** «المدرب»: weekly report, trend alert, chat with مشبب, and the message log (plan §7.3 tab 3). */
export default function Coach({ subject, today, toast }: { subject: Subject; today: string; toast: (m: string) => void }) {
  const [msgs, setMsgs] = useState<CoachMessage[] | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [showLog, setShowLog] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const load = () => data.loadCoachMessages(subject.ownerId).then(setMsgs).catch((e) => toast(e.message));
  useEffect(() => { load(); }, [subject.ownerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const report = useMemo(() => msgs?.find((m) => m.kind === 'weekly_report'), [msgs]);
  const alert = useMemo(() => msgs?.find((m) => m.kind === 'trend_alert' && S.daysBetween(m.created_at.slice(0, 10), today) <= 7), [msgs, today]);
  const chat = useMemo(() => (msgs || []).filter((m) => m.kind === 'chat_user' || m.kind === 'chat_coach').slice(0, 40).reverse(), [msgs]);
  const log = useMemo(() => (msgs || []).filter((m) => KIND_LABEL[m.kind]), [msgs]);
  const usedToday = useMemo(() => (msgs || []).filter((m) => m.kind === 'chat_user' && m.created_at.slice(0, 10) === new Date().toISOString().slice(0, 10)).length, [msgs]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [chat.length]);

  const send = async (msg: string) => {
    const m = msg.trim();
    if (!m || sending) return;
    setSending(true);
    setText('');
    const optimistic: CoachMessage = { id: -Date.now(), kind: 'chat_user', content: m, data: null, created_at: new Date().toISOString(), used_fallback: false };
    setMsgs((cur) => [optimistic, ...(cur || [])]);
    try {
      const r = await data.sendChat(m);
      setRemaining(r.remaining);
      const reply: CoachMessage = { id: -Date.now() - 1, kind: 'chat_coach', content: r.reply, data: null, created_at: new Date().toISOString(), used_fallback: false };
      // Show the reply right away; then refresh from the database without losing it if it isn't there yet.
      setMsgs((cur) => [reply, ...(cur || [])]);
      const fresh = await data.loadCoachMessages(subject.ownerId).catch(() => null);
      if (fresh && fresh.some((x) => x.kind === 'chat_coach' && x.content === r.reply)) setMsgs(fresh);
    } catch (e) {
      toast((e as Error).message);
      setMsgs((cur) => (cur || []).filter((x) => x.id !== optimistic.id));
      setText(m);
    } finally { setSending(false); }
  };

  if (!msgs) return <div className="spinner" />;
  const rep = report?.data?.report as WeeklyReport | undefined;

  return (
    <div>
      {rep ? (
        <div className={`card report tone-${rep.tone}`}>
          <div className="small faint">📊 تقرير الأسبوع · {dateLabel(report!.created_at.slice(0, 10), today)}</div>
          <h2 style={{ margin: '6px 0 12px', fontSize: 20 }}>{rep.headline}</h2>
          <div className="small muted">✅ مشى زين</div>
          <ul className="rep-list">{rep.went_well.map((x, i) => <li key={i}>{x}</li>)}</ul>
          {rep.watch_out.length > 0 && (<><div className="small muted">👀 انتبه</div><ul className="rep-list">{rep.watch_out.map((x, i) => <li key={i}>{x}</li>)}</ul></>)}
          <div className="focus">🎯 {rep.focus_next_week}</div>
        </div>
      ) : (
        <div className="card soft"><b>📊 تقرير الأسبوع</b><p className="muted small" style={{ margin: '6px 0 0' }}>أول تقرير يوصلك نهاية الأسبوع (تقدر تغيّر يومه ووقته من الإعدادات).</p></div>
      )}

      {alert && <div className="banner">{alert.content}</div>}

      <div className="card chat">
        <div className="row between" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>💬 كلّم مشبب</h2>
          <span className="small faint">{(remaining ?? Math.max(0, 30 - usedToday)).toLocaleString('ar-SA')} رسالة باقية اليوم</span>
        </div>
        <div className="bubbles">
          {chat.length === 0 && <p className="muted small center">اسأله أي شي عن نزولك. يعرف أرقامك وأسبوعك.</p>}
          {chat.map((m) => (
            <div key={m.id} className={`bubble ${m.kind === 'chat_user' ? 'me' : 'him'}`}>
              {m.kind === 'chat_coach' && <img className="avatar" src="/icons/mushabbab-avatar.jpg" alt="" />}
              <span>{m.content}</span>
            </div>
          ))}
          {sending && <div className="bubble him"><img className="avatar" src="/icons/mushabbab-avatar.jpg" alt="" /><span className="typing">…</span></div>}
          <div ref={bottom} />
        </div>
        {chat.length === 0 && (
          <div className="chips">{QUICK.map((q) => <button key={q} onClick={() => send(q)} disabled={sending}>{q}</button>)}</div>
        )}
        <form className="comment-form" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="اكتب لمشبب…" />
          <button className="btn accent" disabled={sending || !text.trim()}>إرسال</button>
        </form>
      </div>

      <button className="btn ghost block" onClick={() => setShowLog((v) => !v)}>{showLog ? 'إخفاء' : 'رسايل مشبب السابقة'} ({log.length.toLocaleString('ar-SA')})</button>
      {showLog && (
        <div className="stack" style={{ marginTop: 12 }}>
          {log.map((m) => (
            <div key={m.id} className="card soft small">
              <div className="row between"><b>{KIND_LABEL[m.kind]}</b><span className="faint">{timeAgo(m.created_at)}</span></div>
              <div style={{ whiteSpace: 'pre-line', marginTop: 4 }}>{m.content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
