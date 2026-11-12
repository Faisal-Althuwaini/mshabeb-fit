import { useEffect, useRef, useState } from 'react';
import * as data from '../lib/data';
import type { Comment, FeedView, ItemKind, Reaction } from '../lib/types';
import type { Mutate } from '../lib/data';
import { timeAgo } from '../lib/format';

export const EMOJIS = ['🔥', '💪', '👏', '😅', '👀'];

/** Reactions + comments under any feed item (D16). */
export default function Social({ ownerId, kind, itemRef, me, myName, isOwner, reactions, comments, views = [], watcherNames, onChanged, mutate, toast, highlight }: {
  ownerId: number; kind: ItemKind; itemRef: string; me: string; myName: string | null; isOwner: boolean;
  reactions: Reaction[]; comments: Comment[]; views?: FeedView[]; watcherNames?: Map<string, string>;
  onChanged: () => void; mutate: Mutate; toast: (m: string) => void; highlight?: boolean;
}) {
  // Watchers: mark this item as seen once it has been on screen for ~1s.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isOwner || !box.current || typeof IntersectionObserver === 'undefined') return;
    let timer: number | undefined;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) timer = window.setTimeout(() => { data.markSeen(ownerId, kind, itemRef, me); io.disconnect(); }, 1000);
      else window.clearTimeout(timer);
    }, { threshold: 0.6 });
    io.observe(box.current);
    return () => { io.disconnect(); window.clearTimeout(timer); };
  }, [isOwner, ownerId, kind, itemRef, me]);
  const seenBy = isOwner ? views.filter((v) => v.viewer_auth_user_id !== me).map((v) => watcherNames?.get(v.viewer_auth_user_id) || 'صاحبك') : [];

  const [text, setText] = useState('');
  const [open, setOpen] = useState(highlight || comments.length > 0);
  const mine = reactions.find((r) => r.author_auth_user_id === me)?.emoji ?? null;
  const counts = EMOJIS.map((e) => [e, reactions.filter((r) => r.emoji === e).length] as const);

  const isThis = (r: { owner_user_id: number; item_kind: string; item_ref: string }) =>
    r.owner_user_id === ownerId && r.item_kind === kind && r.item_ref === itemRef;

  // Instant: update the screen first, save in the background, undo if the save fails.
  const tap = (e: string) => {
    const next = mine === e ? null : e;
    const before = reactions;
    mutate((b) => {
      const others = b.reactions.filter((r) => !(isThis(r) && r.author_auth_user_id === me));
      return next == null
        ? { ...b, reactions: others }
        : { ...b, reactions: [...others, { owner_user_id: ownerId, item_kind: kind, item_ref: itemRef, author_auth_user_id: me, emoji: next, created_at: new Date().toISOString() }] };
    });
    navigator.vibrate?.(10);
    data.react(ownerId, kind, itemRef, me, next).then(onChanged).catch((err) => {
      mutate((b) => ({ ...b, reactions: [...b.reactions.filter((r) => !isThis(r)), ...before] }));
      toast((err as Error).message || 'ما انحفظ التفاعل');
    });
  };
  const send = (ev: React.FormEvent) => {
    ev.preventDefault();
    const body = text.trim();
    if (!body) return;
    const temp: Comment = { id: -Date.now(), owner_user_id: ownerId, item_kind: kind, item_ref: itemRef, author_auth_user_id: me, author_name: myName, body, created_at: new Date().toISOString() };
    mutate((b) => ({ ...b, comments: [...b.comments, temp] }));
    setText('');
    data.addComment(ownerId, kind, itemRef, me, myName, body).then(onChanged).catch((err) => {
      mutate((b) => ({ ...b, comments: b.comments.filter((c) => c.id !== temp.id) }));
      setText(body);
      toast((err as Error).message || 'ما انرسل التعليق');
    });
  };
  const del = (id: number) => {
    if (!confirm('تحذف التعليق؟')) return;
    const removed = comments.find((c) => c.id === id);
    mutate((b) => ({ ...b, comments: b.comments.filter((c) => c.id !== id) }));
    data.deleteComment(id).then(onChanged).catch((err) => {
      if (removed) mutate((b) => ({ ...b, comments: [...b.comments, removed] }));
      toast((err as Error).message);
    });
  };

  return (
    <div ref={box} className="social" id={`item-${kind}-${itemRef}`} style={highlight ? { background: 'var(--accent-soft)' } : undefined}>
      <div className="reacts">
        {counts.map(([e, n]) => (
          <button key={e} className={`react ${mine === e ? 'mine' : ''}`} onClick={() => tap(e)} aria-pressed={mine === e} aria-label={`تفاعل ${e}`}>
            {e}{n > 0 && <span className="small">{n.toLocaleString('ar-SA')}</span>}
          </button>
        ))}
        <button className="react" onClick={() => setOpen((o) => !o)} aria-label="تعليقات">💬{comments.length > 0 && <span className="small">{comments.length.toLocaleString('ar-SA')}</span>}</button>
      </div>
      {seenBy.length > 0 && <div className="seen small faint">👀 شافه {seenBy.join('، ')}</div>}
      {open && (
        <>
          {comments.length > 0 && (
            <div className="comments">
              {comments.map((c) => (
                <div key={c.id} className="comment" style={c.id < 0 ? { opacity: 0.6 } : undefined}>
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
            <button className="btn accent" disabled={!text.trim()}>إرسال</button>
          </form>
        </>
      )}
    </div>
  );
}
