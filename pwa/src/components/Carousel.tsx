import { useRef, useState } from 'react';
import Photo from './Photo';
import { arInt } from '../lib/format';

/** Swipeable photos (scroll-snap) with dots and a ١/٤ badge. Works in RTL. */
export default function Carousel({ bucket, paths, className, alt = '' }: { bucket: 'meal-photos' | 'flex-photos'; paths: string[]; className?: string; alt?: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  if (paths.length === 0) return null;
  const onScroll = () => {
    const el = track.current;
    if (!el) return;
    setIdx(Math.min(paths.length - 1, Math.round(Math.abs(el.scrollLeft) / el.clientWidth)));
  };
  const go = (i: number) => {
    const el = track.current;
    if (!el) return;
    const dir = getComputedStyle(el).direction === 'rtl' ? -1 : 1;
    el.scrollTo({ left: dir * i * el.clientWidth, behavior: 'smooth' });
  };
  return (
    <div className={`carousel ${className || ''}`}>
      <div className="track" ref={track} onScroll={onScroll}>
        {paths.map((p, i) => (
          <div className="slide" key={p}><Photo bucket={bucket} path={p} className="ph" alt={`${alt} ${i + 1}`} /></div>
        ))}
      </div>
      {paths.length > 1 && (
        <>
          <span className="count">{arInt(idx + 1)}/{arInt(paths.length)}</span>
          <div className="dots-row">
            {paths.map((p, i) => <button key={p} className={i === idx ? 'on' : ''} onClick={() => go(i)} aria-label={`صورة ${i + 1}`} />)}
          </div>
        </>
      )}
    </div>
  );
}
