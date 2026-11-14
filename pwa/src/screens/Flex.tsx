import { useEffect, useMemo, useRef, useState } from 'react';
import * as S from '../lib/stats';
import * as data from '../lib/data';
import type { Bundle, Mutate } from '../lib/data';
import { MEASURE_FIELDS, type FlexPhoto, type FlexPost, type MeasureKey, type Measurement, type Subject } from '../lib/types';
import { ar, dateLabel, shortDate } from '../lib/format';
import { canvasToJpeg, loadImage, resizeImage } from '../lib/image';
import Carousel from '../components/Carousel';

const MAX_PHOTOS = 4;
type PostView = { post: FlexPost; photos: FlexPhoto[]; m: Measurement | null };

/** Flex v2 (D24): posts of up to 4 photos + weight + optional body measurements. Private by default. */
export default function Flex({ subject, bundle, today, onChanged, mutate, toast }: {
  subject: Subject; bundle: Bundle; today: string; onChanged: () => void; mutate: Mutate; toast: (m: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [compare, setCompare] = useState<{ a: PostView; b: PostView } | null>(null);

  const posts: PostView[] = useMemo(() => {
    const byPost = new Map<number, FlexPhoto[]>();
    for (const ph of bundle.flex) if (ph.post_id != null) (byPost.get(ph.post_id) || byPost.set(ph.post_id, []).get(ph.post_id)!).push(ph);
    const mByDay = new Map(bundle.measurements.map((m) => [m.day, m]));
    return bundle.flexPosts.map((post) => ({
      post, photos: (byPost.get(post.id) || []).sort((x, y) => x.position - y.position), m: mByDay.get(post.taken_on) || null,
    }));
  }, [bundle.flex, bundle.flexPosts, bundle.measurements]);
  const regular = posts.filter((p) => !p.post.is_comparison);
  const comparisons = posts.filter((p) => p.post.is_comparison);
  const ws = S.weekStart(today, subject.settings.week_start_dow ?? 0);
  const hasThisWeek = regular.some((p) => p.post.taken_on >= ws);
  const latestWeight = bundle.entries.length ? bundle.entries[bundle.entries.length - 1].weight : null;
  const lastMeasure = bundle.measurements.length ? bundle.measurements[bundle.measurements.length - 1] : null;

  const toggleSel = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 2 ? [s[1], id] : [...s, id]));
  const openCompare = () => {
    const [a, b] = selected.map((id) => regular.find((p) => p.post.id === id)!).sort((x, y) => x.post.taken_on.localeCompare(y.post.taken_on));
    setCompare({ a, b });
  };

  return (
    <div>
      {!hasThisWeek && <div className="banner">📸 ما صورت فليكس هالأسبوع. صورة وحدة تكفي، ولين ٤ زوايا إذا تبي.</div>}
      <button className="btn accent block" style={{ marginBottom: 8 }} onClick={() => setCreating(true)}>💪 فليكس جديد</button>
      <p className="small muted center" style={{ marginTop: 0 }}>خاصة لك. تقدر تشارك أي واحد مع صاحبك من «يشوفها صاحبي».</p>

      {regular.length >= 2 && (
        <div className="card soft row between">
          <span className="small">{selected.length === 2 ? 'جاهز للمقارنة' : `اختر فليكسين للمقارنة (${ar(selected.length, 0)}/٢)`}</span>
          <button className="btn" disabled={selected.length !== 2} onClick={openCompare}>قارن</button>
        </div>
      )}

      {regular.length === 0 && <p className="muted center">ما فيه فليكس للحين. أول صورة هي «قبل»، وبعدين تشوف الفرق 👀</p>}
      {regular.map((v, i) => (
        <PostCard key={v.post.id} v={v} prev={regular[i + 1] || null} today={today} selectedIdx={selected.indexOf(v.post.id)}
          onSelect={regular.length >= 2 ? () => toggleSel(v.post.id) : undefined} mutate={mutate} onChanged={onChanged} toast={toast} />
      ))}

      {comparisons.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, margin: '20px 0 10px' }}>مقارنات</h2>
          {comparisons.map((v) => <PostCard key={v.post.id} v={v} prev={null} today={today} selectedIdx={-1} mutate={mutate} onChanged={onChanged} toast={toast} />)}
        </>
      )}

      {creating && (
        <NewFlexSheet ownerId={subject.ownerId} today={today} defaultWeight={latestWeight} lastMeasure={lastMeasure}
          onClose={() => setCreating(false)} onDone={() => { setCreating(false); onChanged(); }} toast={toast} />
      )}
      {compare && (
        <CompareSheet a={compare.a} b={compare.b} onClose={() => setCompare(null)}
          onShareFeed={async (blob) => {
            try {
              await data.createFlexPost(subject.ownerId, today, [blob], { weight: latestWeight, shared: true, isComparison: true, alreadySized: true, caption: 'قبل / بعد' });
              toast('تم ✅ نزلت المقارنة لصاحبك');
              setCompare(null); setSelected([]); onChanged();
            } catch (e) { toast((e as Error).message); }
          }} />
      )}
    </div>
  );
}

function PostCard({ v, prev, today, selectedIdx, onSelect, mutate, onChanged, toast }: {
  v: PostView; prev: PostView | null; today: string; selectedIdx: number; onSelect?: () => void; mutate: Mutate; onChanged: () => void; toast: (m: string) => void;
}) {
  const { post, photos, m } = v;
  const dW = post.weight != null && prev?.post.weight != null ? Math.round((post.weight - prev.post.weight) * 10) / 10 : null;
  const setShared = async (on: boolean) => {
    mutate((b) => ({ ...b, flexPosts: b.flexPosts.map((p) => (p.id === post.id ? { ...p, shared_with_watchers: on } : p)) }));
    try { await data.setPostShared(post.id, on); onChanged(); }
    catch (e) { mutate((b) => ({ ...b, flexPosts: b.flexPosts.map((p) => (p.id === post.id ? { ...p, shared_with_watchers: !on } : p)) })); toast((e as Error).message); }
  };
  const del = async () => {
    if (!confirm('تحذف هالفليكس بكل صوره؟')) return;
    mutate((b) => ({ ...b, flexPosts: b.flexPosts.filter((p) => p.id !== post.id), flex: b.flex.filter((p) => p.post_id !== post.id) }));
    try { await data.deleteFlexPost(post, photos); } catch (e) { toast((e as Error).message); }
    onChanged();
  };
  return (
    <div className={`card flex-card ${selectedIdx >= 0 ? 'sel' : ''}`}>
      <Carousel bucket="flex-photos" paths={photos.map((p) => p.storage_path)} alt="فليكس" />
      <div className="meta">
        <div className="row between">
          <div>
            <b>{dateLabel(post.taken_on, today)}</b>
            {post.weight != null && <span className="muted"> · {ar(post.weight)} كغ</span>}
            {dW != null && dW !== 0 && <span className={dW < 0 ? 'down' : 'up'}> ({S.formatDelta(dW)})</span>}
          </div>
          {onSelect && (
            <button className={`btn ${selectedIdx >= 0 ? 'accent' : 'ghost'}`} style={{ minHeight: 34, padding: '0 12px' }} onClick={onSelect}>
              {selectedIdx >= 0 ? `✓ ${selectedIdx === 0 ? '١' : '٢'}` : 'قارن'}
            </button>
          )}
        </div>
        {post.caption && <div className="small" style={{ marginTop: 4 }}>{post.caption}</div>}
        {m && (
          <div className="mchips">
            {MEASURE_FIELDS.filter((f) => m[f.key] != null).map((f) => {
              const pm = prev?.m?.[f.key];
              const d = pm != null && m[f.key] != null ? Math.round(((m[f.key] as number) - pm) * 10) / 10 : null;
              return <span key={f.key}>{f.label} <b>{ar(m[f.key])}</b>{d != null && d !== 0 && <span className={d < 0 ? 'down' : 'up'}> {S.formatDelta(d)}</span>}</span>;
            })}
          </div>
        )}
        <label className="switch small" style={{ marginTop: 6 }}>
          <span>يشوفها صاحبي</span>
          <input type="checkbox" checked={post.shared_with_watchers} onChange={(e) => setShared(e.target.checked)} />
        </label>
        <button className="link-btn faint small" onClick={del}>حذف</button>
      </div>
    </div>
  );
}

function NewFlexSheet({ ownerId, today, defaultWeight, lastMeasure, onClose, onDone, toast }: {
  ownerId: number; today: string; defaultWeight: number | null; lastMeasure: Measurement | null;
  onClose: () => void; onDone: () => void; toast: (m: string) => void;
}) {
  const [files, setFiles] = useState<{ file: File; url: string }[]>([]);
  const [weight, setWeight] = useState(defaultWeight != null ? ar(defaultWeight) : '');
  const [caption, setCaption] = useState('');
  const [shared, setShared] = useState(false);
  const [meas, setMeas] = useState<Partial<Record<MeasureKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => files.forEach((f) => URL.revokeObjectURL(f.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (list: FileList | null) => {
    if (!list) return;
    const room = MAX_PHOTOS - files.length;
    const picked = [...list].slice(0, room).map((file) => ({ file, url: URL.createObjectURL(file) }));
    if (list.length > room) toast(`أقصى شي ${ar(MAX_PHOTOS, 0)} صور`);
    setFiles((f) => [...f, ...picked]);
  };
  const remove = (i: number) => setFiles((f) => { URL.revokeObjectURL(f[i].url); return f.filter((_, j) => j !== i); });

  const save = async () => {
    if (files.length === 0) return toast('اختر صورة وحدة على الأقل');
    let w: number | null = null;
    if (weight.trim()) {
      const r = S.parseWeightInput(weight);
      if (!r.ok) return toast('الوزن ما يبدو صحيح');
      w = r.value;
    }
    const measurements: Partial<Record<MeasureKey, number>> = {};
    for (const f of MEASURE_FIELDS) {
      const raw = (meas[f.key] || '').trim();
      if (!raw) continue;
      const n = Number(S.normalizeDigits(raw));
      if (!Number.isFinite(n) || n <= 0) return toast(`${f.label}: اكتب رقم`);
      measurements[f.key] = Math.round(n * 10) / 10;
    }
    setBusy(true);
    try {
      const sized = await Promise.all(files.map((f) => resizeImage(f.file)));
      await data.createFlexPost(ownerId, today, sized, { weight: w, caption, shared, alreadySized: true, measurements });
      toast('تم 💪');
      onDone();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet stack" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: 0 }}>فليكس جديد</h2>
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        <div className="thumbs">
          {files.map((f, i) => (
            <div className="t" key={f.url}><img src={f.url} alt="" /><button className="x" onClick={() => remove(i)} aria-label="شيل">✕</button></div>
          ))}
          {files.length < MAX_PHOTOS && <div className="t" onClick={() => input.current?.click()} role="button" aria-label="أضف صورة">＋</div>}
        </div>
        <p className="small faint" style={{ margin: 0 }}>لين {ar(MAX_PHOTOS, 0)} صور: قدام، جنب، ورا…</p>
        <label className="field">
          <span>الوزن (من آخر تسجيل، تقدر تعدله)</span>
          <input className="input" inputMode="decimal" dir="ltr" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="١١١٫٢" />
        </label>
        <details className="box">
          <summary>📏 قياسات الجسم (اختياري)</summary>
          <div className="measure-grid" style={{ marginTop: 10 }}>
            {MEASURE_FIELDS.map((f) => (
              <label key={f.key} className="field">
                <span>{f.label} ({f.unit})</span>
                <input className="input" inputMode="decimal" dir="ltr" value={meas[f.key] || ''}
                  placeholder={lastMeasure?.[f.key] != null ? ar(lastMeasure[f.key]) : ''}
                  onChange={(e) => setMeas((m) => ({ ...m, [f.key]: e.target.value }))} />
              </label>
            ))}
          </div>
          <p className="small faint" style={{ marginBottom: 0 }}>الرمادي = آخر قياس.</p>
        </details>
        <input className="input" placeholder="تعليق (اختياري)" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={500} />
        <label className="switch"><span>يشوفها صاحبي</span><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /></label>
        <div className="grid2">
          <button className="btn accent" onClick={save} disabled={busy || files.length === 0}>{busy ? '…' : 'حفظ'}</button>
          <button className="btn ghost" onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}

/** Side-by-side of the same angle from two posts, with dates and weights, small «مشبب» mark. */
function CompareSheet({ a, b, onClose, onShareFeed }: { a: PostView; b: PostView; onClose: () => void; onShareFeed: (blob: Blob) => void }) {
  const angles = Math.max(1, Math.min(a.photos.length, b.photos.length));
  const [angle, setAngle] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setBlob(null);
    (async () => {
      const pa = a.photos[angle] || a.photos[0];
      const pb = b.photos[angle] || b.photos[0];
      const urls = await data.signedUrls('flex-photos', [pa.storage_path, pb.storage_path]);
      const [ia, ib] = await Promise.all([loadImage(urls[pa.storage_path]), loadImage(urls[pb.storage_path])]);
      const out = await renderCompare(ia, a, ib, b);
      if (alive) { setBlob(out); setUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(out); }); }
    })().catch(() => undefined);
    return () => { alive = false; };
  }, [a, b, angle]);
  const file = blob ? new File([blob], 'mushabbab-compare.jpg', { type: 'image/jpeg' }) : null;
  const canShare = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet stack" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: 0 }}>قبل / بعد</h2>
        {angles > 1 && (
          <div className="seg" style={{ marginTop: 0 }}>
            {Array.from({ length: angles }, (_, i) => <button key={i} className={i === angle ? 'on' : ''} onClick={() => setAngle(i)}>زاوية {ar(i + 1, 0)}</button>)}
          </div>
        )}
        {url ? <img src={url} alt="مقارنة" style={{ borderRadius: 14, width: '100%' }} /> : <div className="spinner" />}
        <div className="grid2">
          {canShare ? (
            <button className="btn accent" onClick={() => navigator.share({ files: [file!] }).catch(() => undefined)}>شارك (واتساب…)</button>
          ) : (
            <a className="btn accent" href={url || '#'} download="mushabbab-compare.jpg">تنزيل</a>
          )}
          <button className="btn" disabled={!blob} onClick={() => blob && onShareFeed(blob)}>نزّلها لصاحبي</button>
        </div>
        <button className="btn ghost block" onClick={onClose}>إغلاق</button>
      </div>
    </div>
  );
}

async function renderCompare(ia: HTMLImageElement, a: PostView, ib: HTMLImageElement, b: PostView): Promise<Blob> {
  const W = 1600, H = 1100, pad = 24, labelH = 110;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  const cellW = (W - pad * 3) / 2, cellH = H - pad * 2 - labelH;
  const cells: [HTMLImageElement, PostView, number][] = [[ia, a, pad * 2 + cellW], [ib, b, pad]]; // RTL: earlier on the right
  await document.fonts.ready;
  for (const [img, v, x] of cells) {
    const s = Math.max(cellW / img.width, cellH / img.height);
    const sw = cellW / s, sh = cellH / s;
    g.save(); g.beginPath(); g.roundRect(x, pad, cellW, cellH, 20); g.clip();
    g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, pad, cellW, cellH);
    g.restore();
    g.fillStyle = '#141414'; g.textAlign = 'center'; g.direction = 'rtl';
    g.font = "700 52px 'Thmanyah Sans', 'IBM Plex Sans Arabic', sans-serif";
    g.fillText(v.post.weight != null ? `${ar(v.post.weight)} كغ` : '', x + cellW / 2, pad + cellH + 58);
    g.font = "400 32px 'Thmanyah Sans', 'IBM Plex Sans Arabic', sans-serif"; g.fillStyle = '#57534e';
    g.fillText(shortDate(v.post.taken_on), x + cellW / 2, pad + cellH + 100);
  }
  g.font = "500 26px 'Thmanyah Sans', 'IBM Plex Sans Arabic', sans-serif"; g.fillStyle = '#177a36'; g.textAlign = 'left';
  g.fillText('مشبب', pad + 8, H - 18);
  return canvasToJpeg(c, 0.9);
}
