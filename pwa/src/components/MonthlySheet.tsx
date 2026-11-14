import { useEffect, useMemo, useState } from 'react';
import * as data from '../lib/data';
import type { Bundle } from '../lib/data';
import type { Subject } from '../lib/types';
import { MEASURE_FIELDS } from '../lib/types';
import * as S from '../lib/stats';
import { availableMonths, defaultMonth, monthlySummary, MONTHS_AR, type MonthlySummary } from '../lib/monthly';
import { canvasToJpeg, loadImage } from '../lib/image';
import { shortDate } from '../lib/format';

const W = 1080, H = 1350;
const C = { bg: '#0e0e0d', card: '#1c1b1a', line: '#2c2a28', ink: '#f5f5f4', muted: '#a8a29e', green: '#2fbf5b', amber: '#f59e0b' };
const FONT = (w: number, px: number) => `${w} ${px}px 'Thmanyah Sans', 'IBM Plex Sans Arabic', sans-serif`;
const ar = (n: number, d = 1) => S.toArabicDigits(n, d);

/** «ملخص الشهر»: one shareable image with before/after, weight change, measurements and streaks. */
export default function MonthlySheet({ subject, bundle, today, onClose, toast }: {
  subject: Subject; bundle: Bundle; today: string; onClose: () => void; toast: (m: string) => void;
}) {
  const months = useMemo(() => availableMonths(bundle, today), [bundle, today]);
  const [month, setMonth] = useState(() => (months.includes(defaultMonth(today)) ? defaultMonth(today) : months[0]));
  const summary = useMemo(() => monthlySummary(bundle, month, today, subject.settings), [bundle, month, today, subject.settings]);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    let alive = true;
    setBlob(null);
    render(summary).then((b) => {
      if (!alive) return;
      setBlob(b);
      setUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(b); });
    }).catch((e) => toast((e as Error).message));
    return () => { alive = false; };
  }, [summary]); // eslint-disable-line react-hooks/exhaustive-deps

  const file = blob ? new File([blob], `mushabbab-${month}.jpg`, { type: 'image/jpeg' }) : null;
  const canShare = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet stack" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: 0 }}>📅 ملخص الشهر</h2>
        <div className="day-chips">
          {months.map((m) => {
            const [y, mo] = m.split('-').map(Number);
            return <button key={m} className={m === month ? 'on' : ''} onClick={() => setMonth(m)}>{MONTHS_AR[mo - 1]} {y !== Number(today.slice(0, 4)) ? ar(y, 0) : ''}</button>;
          })}
        </div>
        {url ? <img src={url} alt={`ملخص ${summary.label}`} style={{ borderRadius: 14, width: '100%' }} /> : <div className="spinner" />}
        <div className="grid2">
          {canShare ? (
            <button className="btn accent" onClick={() => navigator.share({ files: [file!], text: `ملخص ${summary.label} 💪` }).catch(() => undefined)}>شارك (واتساب…)</button>
          ) : (
            <a className="btn accent" href={url || '#'} download={`mushabbab-${month}.jpg`}>تنزيل</a>
          )}
          {subject.isOwner && (
            <button className="btn" disabled={!blob || posting} onClick={async () => {
              setPosting(true);
              try {
                await data.createFlexPost(subject.ownerId, today, [blob!], { weight: summary.endWeight, shared: true, isComparison: true, alreadySized: true, caption: `ملخص ${summary.label}` });
                toast('تم ✅ نزل الملخص لصاحبك');
                onClose();
              } catch (e) { toast((e as Error).message); } finally { setPosting(false); }
            }}>نزّله لصاحبي</button>
          )}
        </div>
        <button className="btn ghost block" onClick={onClose}>إغلاق</button>
      </div>
    </div>
  );
}

// ── Drawing ──────────────────────────────────────────────────────────────

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.roundRect(x, y, w, h, r);
}
function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = 'right') {
  g.font = font; g.fillStyle = color; g.textAlign = align; g.direction = 'rtl'; g.fillText(s, x, y);
}
function cover(g: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, r: number) {
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s, sh = h / s;
  g.save(); rr(g, x, y, w, h, r); g.clip();
  g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
  g.restore();
}

async function photoImg(path: string) {
  if (import.meta.env.DEV && path.startsWith('demo')) return loadImage('/icons/mushabbab-avatar.jpg'); // dev demo stand-in
  const urls = await data.signedUrls('flex-photos', [path]);
  return loadImage(urls[path]);
}

async function render(m: MonthlySummary): Promise<Blob> {
  await Promise.all([document.fonts.load(FONT(700, 40)), document.fonts.load(FONT(400, 40))]).catch(() => undefined);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const pad = 56;
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);

  // Header: avatar + name, title
  try {
    const av = await loadImage('/icons/mushabbab-avatar.jpg');
    g.save(); g.beginPath(); g.arc(W - pad - 36, pad + 36, 36, 0, Math.PI * 2); g.clip();
    g.drawImage(av, W - pad - 72, pad, 72, 72); g.restore();
    g.strokeStyle = C.green; g.lineWidth = 4; g.beginPath(); g.arc(W - pad - 36, pad + 36, 36, 0, Math.PI * 2); g.stroke();
  } catch { /* avatar optional */ }
  text(g, 'مشبب', W - pad - 92, pad + 48, FONT(700, 34), C.muted);
  text(g, `ملخص ${m.label}`, W - pad, pad + 150, FONT(700, 68), C.ink);

  // Photos
  let y = pad + 190;
  const photoH = 420;
  const hasPair = m.before && m.after;
  if (m.after) {
    try {
      if (hasPair) {
        const cw = (W - pad * 2 - 24) / 2;
        const [ib, ia] = await Promise.all([photoImg(m.before!.photo.storage_path), photoImg(m.after.photo.storage_path)]);
        // RTL: before on the right, after on the left
        cover(g, ib, W - pad - cw, y, cw, photoH, 28);
        cover(g, ia, pad, y, cw, photoH, 28);
        const lbl = (p: { post: { taken_on: string; weight: number | null } }, x: number, tag: string) => {
          text(g, tag, x, y + photoH + 46, FONT(700, 32), C.ink, 'center');
          text(g, `${shortDate(p.post.taken_on)}${p.post.weight != null ? `  ·  ${ar(p.post.weight)} كغ` : ''}`, x, y + photoH + 86, FONT(400, 27), C.muted, 'center');
        };
        lbl(m.before!, W - pad - cw / 2, 'قبل');
        lbl(m.after, pad + cw / 2, 'بعد');
      } else {
        const iw = 420;
        const ia = await photoImg(m.after.photo.storage_path);
        cover(g, ia, (W - iw) / 2, y, iw, photoH, 28);
      }
      y += photoH + (hasPair ? 112 : 36);
    } catch {
      y += 0; // photos failed to load → numbers only
    }
  }

  // Big weight change
  if (m.change != null) {
    const good = m.change <= 0;
    // Direction in words (canvas mangles a leading minus in RTL text).
    const verb = m.change < 0 ? 'نزلت' : m.change > 0 ? 'زدت' : 'ثابت';
    text(g, m.change === 0 ? 'ثابت' : `${verb} ${ar(Math.abs(m.change))} كغ`, W / 2, y + 108, FONT(700, 104), good ? C.green : C.amber, 'center');
    text(g, `من ${ar(m.startWeight!)} إلى ${ar(m.endWeight!)}  ·  ${ar(m.weighIns, 0)} وزنة`, W / 2, y + 160, FONT(400, 30), C.muted, 'center');
    y += 196;
  } else {
    text(g, m.weighIns ? `${ar(m.weighIns, 0)} وزنة هالشهر` : 'شهر جديد، بداية جديدة', W / 2, y + 90, FONT(700, 64), C.ink, 'center');
    y += 130;
  }

  // Stats grid (2×2)
  const firstMeasure = m.measures[0];
  const cells: [string, string][] = [
    ['🔥 أطول سلسلة', `${ar(m.bestStreak, 0)} يوم`],
    ['🚶 أقل شي', `${ar(m.minimumDays, 0)} من ${ar(m.days, 0)}`],
    ['🏋️ حديد', `${ar(m.liftingDays, 0)} حصة`],
    firstMeasure
      ? [`📏 ${MEASURE_FIELDS.find((f) => f.key === firstMeasure.key)!.label} ${firstMeasure.change < 0 ? 'نزل' : firstMeasure.change > 0 ? 'زاد' : 'ثابت'}`,
         `${ar(Math.abs(firstMeasure.change))} ${MEASURE_FIELDS.find((f) => f.key === firstMeasure.key)!.unit}`]
      : ['⚖️ وزنات', `${ar(m.weighIns, 0)}`],
  ];
  const gap = 18, cw = (W - pad * 2 - gap) / 2;
  // Use the room left above the footer, between 110 and 150 px per row.
  const gridH = Math.max(110, Math.min(150, (H - pad - 70 - y - gap) / 2));
  cells.forEach(([label, value], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = col === 0 ? W - pad - cw : pad; // RTL: first column on the right
    const cy = y + row * (gridH + gap);
    g.fillStyle = C.card; rr(g, x, cy, cw, gridH, 24); g.fill();
    text(g, label, x + cw - 28, cy + 44, FONT(400, 28), C.muted);
    text(g, value, x + cw - 28, cy + gridH - 24, FONT(700, 46), C.ink);
  });
  y += gridH * 2 + gap;

  // Footer
  const foot = m.nextStep != null && m.remaining != null && m.remaining > 0
    ? `🪜 الدرجة الجاية ${ar(m.nextStep)}  ·  باقي ${ar(m.remaining)} كيلو`
    : 'لا تغيب مرتين · أقل شي يكفي';
  text(g, foot, W / 2, H - pad, FONT(500, 32), C.green, 'center');
  return canvasToJpeg(c, 0.9);
}
