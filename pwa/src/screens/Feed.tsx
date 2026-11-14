import { useEffect, useMemo, useRef, useState } from 'react';
import * as data from '../lib/data';
import type { Bundle, Mutate } from '../lib/data';
import type { Subject, WhoAmI } from '../lib/types';
import { buildDays, indexSocial, itemKey } from '../lib/feed';
import { ar, dateLabel, timeAgo } from '../lib/format';
import Photo from '../components/Photo';
import Carousel from '../components/Carousel';
import { MEASURE_FIELDS } from '../lib/types';
import Social from '../components/Social';
import PushCard from '../components/PushCard';

export default function Feed({ subject, bundle, today, me, who, onChanged, mutate, toast }: {
  subject: Subject; bundle: Bundle; today: string; me: string; who: WhoAmI; onChanged: () => void; mutate: Mutate; toast: (m: string) => void;
}) {
  const [limit, setLimit] = useState(14);
  const [posting, setPosting] = useState(false);
  const days = useMemo(() => buildDays(bundle, limit), [bundle, limit]);
  const social = useMemo(() => indexSocial(bundle.reactions, bundle.comments), [bundle.reactions, bundle.comments]);
  const viewsByItem = useMemo(() => {
    const m = new Map<string, typeof bundle.views>();
    for (const v of bundle.views) { const k = itemKey(v.item_kind, v.item_ref); (m.get(k) || m.set(k, []).get(k)!).push(v); }
    return m;
  }, [bundle.views]);
  const watcherNames = useMemo(() => new Map(bundle.watchers.map((w) => [w.watcher_auth_user_id, w.display_name || 'صاحبك'])), [bundle.watchers]);
  const highlight = new URLSearchParams(location.search).get('item');
  const myName = subject.isOwner ? who.first_name : who.my_watcher_name ?? null;

  // Scroll to the item a notification pointed at.
  useEffect(() => {
    if (!highlight) return;
    const [kind, ref] = highlight.split(':');
    const el = document.getElementById(`item-${kind}-${ref}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlight, days.length]);

  const socialFor = (kind: 'meal' | 'flex' | 'day', ref: string | number) => {
    const k = itemKey(kind, ref);
    return (
      <Social
        ownerId={subject.ownerId} kind={kind} itemRef={String(ref)} me={me} myName={myName}
        isOwner={subject.isOwner} reactions={social.reactions.get(k) || []} comments={social.comments.get(k) || []}
        views={viewsByItem.get(k) || []} watcherNames={watcherNames}
        onChanged={onChanged} mutate={mutate} toast={toast} highlight={highlight === k}
      />
    );
  };

  return (
    <div>
      <PushCard authUserId={me} toast={toast} hideWhenOn />
      {subject.isOwner && (
        <button className="btn accent block" style={{ marginBottom: 12 }} onClick={() => setPosting(true)}>📸 نزّل وجبة</button>
      )}
      {days.length === 0 && <p className="muted center">ما فيه شي للحين.</p>}
      {days.map((d) => (
        <article key={d.day} className="card day-card">
          <div className="day-head">
            <div className="row between">
              <span className="date">{dateLabel(d.day, today)}</span>
              {d.weight != null && <span className="day-weight">{ar(d.weight)}</span>}
            </div>
            {d.check && (
              <div className="pills">
                {d.check.minimum_done && <span className="pill m">🚶 مشى</span>}
                {d.check.lifted && <span className="pill l">🏋️ حديد{d.check.workout_label === 'anterior' ? ' · أمامي' : d.check.workout_label === 'posterior' ? ' · خلفي' : ''}</span>}
              </div>
            )}
          </div>
          {d.events.map((ev) => (
            <div key={ev.id} className={`event ${ev.kind === 'milestone' ? 'win' : ''}`}>
              {ev.kind === 'milestone'
                ? subject.isOwner
                  ? `🎉 نزلت تحت ${ar(ev.data?.step ?? 0)}!${ev.data?.avg != null ? ` متوسط الأسبوع ${ar(ev.data.avg)}` : ''}`
                  : `🎉 ${subject.name} نزل تحت ${ar(ev.data?.step ?? 0)}! حط له 🔥`
                : subject.isOwner
                  ? `قلنا لصاحبك إنك غايب من ${ar(ev.data?.days ?? 3, 0)} أيام. ارجع اليوم بأقل شي 💪`
                  : `${subject.name} غايب من ${ar(ev.data?.days ?? 3, 0)} أيام، يمكن يحتاج كلمة منك 👋`}
            </div>
          ))}
          {(d.weight != null || d.check || d.events.some((e) => e.kind === 'milestone')) && socialFor('day', d.day)}
          {d.meals.map((m) => (
            <div key={m.id} className="post">
              <Photo bucket="meal-photos" path={m.storage_path} className="ph" alt={m.caption || 'وجبة'} />
              {m.caption && <div className="cap">{m.caption}</div>}
              <div className="meta row between">
                <span>🍽️ {timeAgo(m.posted_at)}</span>
                {subject.isOwner && (
                  <button className="x link-btn faint small" onClick={async () => {
                    if (!confirm('تحذف الوجبة؟')) return;
                    mutate((b) => ({ ...b, meals: b.meals.filter((x) => x.id !== m.id) }));
                    try { await data.deleteMeal(m); } catch (e) { toast((e as Error).message); }
                    onChanged();
                  }}>حذف</button>
                )}
              </div>
              {socialFor('meal', m.id)}
            </div>
          ))}
          {d.flex.map(({ post, photos, m }) => (
            <div key={post.id} className="post">
              <Carousel bucket="flex-photos" paths={photos.map((p) => p.storage_path)} alt="فليكس" />
              <div className="cap">
                💪 {post.is_comparison ? 'قبل / بعد' : 'فليكس'}{post.weight != null && <> · <b>{ar(post.weight)}</b> كغ</>}{post.caption && !post.is_comparison && <> · {post.caption}</>}
              </div>
              {m && (
                <div className="mchips" style={{ padding: '0 16px' }}>
                  {MEASURE_FIELDS.filter((f) => m[f.key] != null).map((f) => <span key={f.key}>{f.label} <b>{ar(m[f.key])}</b></span>)}
                </div>
              )}
              {socialFor('flex', post.id)}
            </div>
          ))}
        </article>
      ))}
      {days.length >= limit && <button className="btn ghost block" onClick={() => setLimit((l) => l + 14)}>أقدم</button>}
      {posting && <PostMeal ownerId={subject.ownerId} today={today} onClose={() => setPosting(false)} onDone={() => { setPosting(false); onChanged(); }} toast={toast} />}
    </div>
  );
}

function PostMeal({ ownerId, today, onClose, onDone, toast }: { ownerId: number; today: string; onClose: () => void; onDone: () => void; toast: (m: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const post = async () => {
    if (!file) return;
    setBusy(true);
    try { await data.postMeal(ownerId, today, file, caption); toast('تم 📸'); onDone(); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet stack" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: 0 }}>وجبة جديدة</h2>
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => {
          const f = e.target.files?.[0] || null;
          setFile(f);
          setPreview(f ? URL.createObjectURL(f) : null);
        }} />
        {preview ? <img src={preview} alt="" style={{ borderRadius: 14, maxHeight: 360, objectFit: 'cover', width: '100%' }} onClick={() => input.current?.click()} />
          : <button className="btn ghost block" style={{ minHeight: 160 }} onClick={() => input.current?.click()}>📷 صوّر أو اختر صورة</button>}
        <input className="input" placeholder="وش أكلت؟ (اختياري)" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={500} />
        <div className="grid2">
          <button className="btn accent" onClick={post} disabled={!file || busy}>{busy ? '…' : 'نزّلها'}</button>
          <button className="btn ghost" onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}
