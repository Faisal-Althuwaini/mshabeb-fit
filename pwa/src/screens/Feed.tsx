import { useEffect, useMemo, useRef, useState } from 'react';
import * as data from '../lib/data';
import type { Bundle } from '../lib/data';
import type { Subject, WhoAmI } from '../lib/types';
import { buildDays, indexSocial, itemKey } from '../lib/feed';
import { ar, dateLabel, timeAgo } from '../lib/format';
import Photo from '../components/Photo';
import Social from '../components/Social';
import PushCard from '../components/PushCard';

export default function Feed({ subject, bundle, today, me, who, onChanged, toast }: {
  subject: Subject; bundle: Bundle; today: string; me: string; who: WhoAmI; onChanged: () => void; toast: (m: string) => void;
}) {
  const [limit, setLimit] = useState(14);
  const [posting, setPosting] = useState(false);
  const days = useMemo(() => buildDays(bundle, limit), [bundle, limit]);
  const social = useMemo(() => indexSocial(bundle.reactions, bundle.comments), [bundle.reactions, bundle.comments]);
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
        onChanged={onChanged} toast={toast} highlight={highlight === k}
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
            <div key={ev.id} className="event">
              {subject.isOwner
                ? `قلنا لصاحبك إنك غايب من ${ar(ev.data?.days ?? 3, 0)} أيام. ارجع اليوم بيوم أدنى 💪`
                : `${subject.name} غايب من ${ar(ev.data?.days ?? 3, 0)} أيام، يمكن يحتاج كلمة منك 👋`}
            </div>
          ))}
          {(d.weight != null || d.check) && socialFor('day', d.day)}
          {d.meals.map((m) => (
            <div key={m.id} className="post">
              <Photo bucket="meal-photos" path={m.storage_path} className="ph" alt={m.caption || 'وجبة'} />
              {m.caption && <div className="cap">{m.caption}</div>}
              <div className="meta row between">
                <span>🍽️ {timeAgo(m.posted_at)}</span>
                {subject.isOwner && (
                  <button className="x link-btn faint small" onClick={async () => { if (confirm('تحذف الوجبة؟')) { await data.deleteMeal(m); onChanged(); } }}>حذف</button>
                )}
              </div>
              {socialFor('meal', m.id)}
            </div>
          ))}
          {d.flex.map((f) => (
            <div key={f.id} className="post">
              <Photo bucket="flex-photos" path={f.storage_path} className="ph" alt="فليكس" />
              <div className="cap">💪 فليكس{f.weight_at_time != null && <> · {ar(f.weight_at_time)}</>}{f.caption && <> · {f.caption}</>}</div>
              {socialFor('flex', f.id)}
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
