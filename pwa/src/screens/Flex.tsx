import { useEffect, useRef, useState } from 'react';
import * as S from '../lib/stats';
import * as data from '../lib/data';
import type { Bundle } from '../lib/data';
import type { FlexPhoto, Subject } from '../lib/types';
import { ar, shortDate } from '../lib/format';
import { canvasToJpeg, loadImage } from '../lib/image';
import Photo from '../components/Photo';

/** Flex photos (D15): private by default, «يشوفها صاحبي» per photo, side-by-side compare. */
export default function Flex({ subject, bundle, today, onChanged, toast }: {
  subject: Subject; bundle: Bundle; today: string; onChanged: () => void; toast: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [compare, setCompare] = useState<Blob | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const photos = bundle.flex.filter((f) => !f.is_comparison);
  const comparisons = bundle.flex.filter((f) => f.is_comparison);
  const ws = S.weekStart(today, subject.settings.week_start_dow ?? 0);
  const hasThisWeek = photos.some((p) => p.taken_on >= ws);
  const latestWeight = bundle.entries.length ? bundle.entries[bundle.entries.length - 1].weight : null;

  const upload = async (file: File) => {
    setBusy(true);
    try { await data.addFlex(subject.ownerId, today, file, { weight: latestWeight }); toast('تم 💪 محفوظة لك بس'); onChanged(); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  const toggleSel = (id: number) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 2 ? [s[1], id] : [...s, id]));

  const makeCompare = async () => {
    const [a, b] = selected.map((id) => photos.find((p) => p.id === id)!).sort((x, y) => x.taken_on.localeCompare(y.taken_on));
    setBusy(true);
    try {
      const urls = await data.signedUrls('flex-photos', [a.storage_path, b.storage_path]);
      const [ia, ib] = await Promise.all([loadImage(urls[a.storage_path]), loadImage(urls[b.storage_path])]);
      setCompare(await renderCompare(ia, a, ib, b));
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div>
      {!hasThisWeek && <div className="banner">📸 ما صورت فليكس هالأسبوع. صورة وحدة بالأسبوع تكفي.</div>}
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
      <button className="btn accent block" style={{ marginBottom: 8 }} onClick={() => input.current?.click()} disabled={busy}>💪 صورة فليكس جديدة</button>
      <p className="small muted center" style={{ marginTop: 0 }}>الصور خاصة لك. تقدر تشارك أي صورة مع صاحبك من «يشوفها صاحبي». ومن تيليجرام: أرسل صورة واكتب «فليكس».</p>

      {photos.length >= 2 && (
        <div className="card soft row between">
          <span className="small">{selected.length === 2 ? 'جاهز للمقارنة' : `اختر صورتين للمقارنة (${ar(selected.length, 0)}/٢)`}</span>
          <button className="btn" disabled={selected.length !== 2 || busy} onClick={makeCompare}>قارن</button>
        </div>
      )}

      <div className="flex-grid">
        {photos.map((p) => (
          <FlexItem key={p.id} p={p} selected={selected.indexOf(p.id)} onSelect={() => toggleSel(p.id)} onChanged={onChanged} toast={toast} />
        ))}
      </div>

      {comparisons.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, margin: '20px 0 10px' }}>مقارنات</h2>
          <div className="flex-grid">
            {comparisons.map((p) => <FlexItem key={p.id} p={p} selected={-1} onChanged={onChanged} toast={toast} />)}
          </div>
        </>
      )}

      {compare && (
        <CompareSheet
          blob={compare}
          onClose={() => setCompare(null)}
          onShareFeed={async () => {
            try {
              await data.addFlex(subject.ownerId, today, compare, { weight: latestWeight, shared: true, isComparison: true, alreadySized: true, caption: 'قبل / بعد' });
              toast('تم ✅ نزلت المقارنة لصاحبك');
              setCompare(null); setSelected([]); onChanged();
            } catch (e) { toast((e as Error).message); }
          }}
        />
      )}
    </div>
  );
}

function FlexItem({ p, selected, onSelect, onChanged, toast }: { p: FlexPhoto; selected: number; onSelect?: () => void; onChanged: () => void; toast: (m: string) => void }) {
  return (
    <div className={`flex-item ${selected >= 0 ? 'sel' : ''}`}>
      <div onClick={onSelect} style={{ cursor: onSelect ? 'pointer' : 'default' }}>
        <Photo bucket="flex-photos" path={p.storage_path} alt="فليكس" />
        {selected >= 0 && <span className="sel-mark">{selected === 0 ? '١' : '٢'}</span>}
      </div>
      <div className="info">
        <div className="row between"><b>{shortDate(p.taken_on)}</b><span className="muted">{p.weight_at_time != null ? ar(p.weight_at_time) : ''}</span></div>
        <label className="switch small">
          <span>يشوفها صاحبي</span>
          <input type="checkbox" checked={p.shared_with_watchers} onChange={async (e) => {
            try { await data.setFlexShared(p.id, e.target.checked); onChanged(); } catch (err) { toast((err as Error).message); }
          }} />
        </label>
        <button className="link-btn faint small" onClick={async () => { if (confirm('تحذف الصورة؟')) { await data.deleteFlex(p); onChanged(); } }}>حذف</button>
      </div>
    </div>
  );
}

/** Side-by-side with dates and weights, small «مشبب» mark (plan §7.3). */
async function renderCompare(ia: HTMLImageElement, a: FlexPhoto, ib: HTMLImageElement, b: FlexPhoto): Promise<Blob> {
  const W = 1600, H = 1100, pad = 24, labelH = 110;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  const cellW = (W - pad * 3) / 2, cellH = H - pad * 2 - labelH;
  // RTL: earlier photo on the right, later on the left.
  const cells: [HTMLImageElement, FlexPhoto, number][] = [[ia, a, pad * 2 + cellW], [ib, b, pad]];
  await document.fonts.ready;
  for (const [img, p, x] of cells) {
    const s = Math.max(cellW / img.width, cellH / img.height);
    const sw = cellW / s, sh = cellH / s;
    g.save();
    g.beginPath(); g.roundRect(x, pad, cellW, cellH, 20); g.clip();
    g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, pad, cellW, cellH);
    g.restore();
    g.fillStyle = '#141414'; g.textAlign = 'center'; g.direction = 'rtl';
    g.font = "700 52px 'Thmanyah Sans', 'IBM Plex Sans Arabic', sans-serif";
    g.fillText(p.weight_at_time != null ? `${ar(p.weight_at_time)} كغ` : '', x + cellW / 2, pad + cellH + 58);
    g.font = "400 32px 'Thmanyah Sans', 'IBM Plex Sans Arabic', sans-serif"; g.fillStyle = '#57534e';
    g.fillText(shortDate(p.taken_on) + ' ' + p.taken_on.slice(0, 4).replace(/\d/g, (d) => String.fromCharCode(0x660 + Number(d))), x + cellW / 2, pad + cellH + 100);
  }
  g.font = "500 26px 'Thmanyah Sans', 'IBM Plex Sans Arabic', sans-serif"; g.fillStyle = '#177a36'; g.textAlign = 'left';
  g.fillText('مشبب', pad + 8, H - 18);
  return canvasToJpeg(c, 0.9);
}

function CompareSheet({ blob, onClose, onShareFeed }: { blob: Blob; onClose: () => void; onShareFeed: () => void }) {
  const [url] = useState(() => URL.createObjectURL(blob));
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const file = new File([blob], 'mushabbab-compare.jpg', { type: 'image/jpeg' });
  const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet stack" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: 0 }}>قبل / بعد</h2>
        <img src={url} alt="مقارنة" style={{ borderRadius: 14, width: '100%' }} />
        <div className="grid2">
          {canShare ? (
            <button className="btn accent" onClick={() => navigator.share({ files: [file] }).catch(() => undefined)}>شارك (واتساب…)</button>
          ) : (
            <a className="btn accent" href={url} download="mushabbab-compare.jpg">تنزيل</a>
          )}
          <button className="btn" onClick={onShareFeed}>نزّلها لصاحبي</button>
        </div>
        <button className="btn ghost block" onClick={onClose}>إغلاق</button>
      </div>
    </div>
  );
}
