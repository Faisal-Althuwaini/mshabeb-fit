import { useState } from 'react';
import * as data from '../lib/data';
import type { Comment, ItemKind, Reaction } from '../lib/types';
import { timeAgo } from '../lib/format';

export const EMOJIS = ['🔥', '💪', '👏', '😅', '👀'];

/** Reactions + comments under any feed item (D16). */
export default function Social({ ownerId, kind, itemRef, me, myName, isOwner, reactions, comments, onChanged, toast, highlight }: {
  ownerId: number; kind: ItemKind; itemRef: string; me: string; myName: string | null; isOwner: boolean;
  reactions: Reaction[]; comments: Comment[]; onChanged: () => void; toast: (m: string) => void; highlight?: boolean;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(highlight || comments.length > 0);
  const mine = reactions.find((r) => r.author_auth_user_id === me)?.emoji ?? null;
  const counts = EMOJIS.map((e) => [e, reactions.filter((r) => r.emoji === e).length] as const);

  const tap = async (e: string) => {
    try { await data.react(ownerId, kind, itemRef, me, mine === e ? null : e); onChanged(); }
    catch (err) { toast((err as Error).message); }
  };
  const send = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try { await data.addComment(ownerId, kind, itemRef, me, myName, text); setText(''); onChanged(); }
    catch (err) { toast((err as Error).message); }
    finally { setBusy(false); }
  };
  const del = async (id: number) => {
    if (!confirm('تحذف التعليق؟')) return;
    try { await data.deleteComment(id); onChanged(); } catch (err) { toast((err as Error).message); }
  };

  return (
    <div className="social" id={`item-${kind}-${itemRef}`} style={highlight ? { background: 'var(--accent-soft)' } : undefined}>
      <div className="reacts">
        {counts.map(([e, n]) => (
          <button key={e} className={`react ${mine === e ? 'mine' : ''}`} onClick={() => tap(e)} aria-pressed={mine === e} aria-label={`تفاعل ${e}`}>
            {e}{n > 0 && <span className="small">{n.toLocaleString('ar-SA')}</span>}
          </button>
        ))}
        <button className="react" onClick={() => setOpen((o) => !o)} aria-label="تعليقات">💬{comments.length > 0 && <span className="small">{comments.length.toLocaleString('ar-SA')}</span>}</button>
      </div>
      {open && (
        <>
          {comments.length > 0 && (
            <div className="comments">
              {comments.map((c) => (
                <div key={c.id} className="comment">
                  <div className="row between">
                    <b>{c.author_auth_user_id === me ? 'أنت' : c.author_name || 'صاحبك'}</b>
                    <span className="row">
                      <span className="faint small">{timeAgo(c.created_at)}</span>
                      {(c.author_auth_user_id === me || isOwner) && <button className="x" onClick={() => del(c.id)} aria-label="حذف">✕</button>}
                    </span>
                  </div>
                  <div>{c.body}</div>
                </div>
              ))}
            </div>
          )}
          <form className="comment-form" onSubmit={send}>
            <input className="input" value={text} onChange={(e) => setText(e.target.value)} maxLength={280} placeholder={isOwner ? 'رد…' : 'اكتب تعليق…'} />
            <button className="btn accent" disabled={busy || !text.trim()}>إرسال</button>
          </form>
        </>
      )}
    </div>
  );
}
