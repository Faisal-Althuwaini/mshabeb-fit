import { useEffect, useState } from 'react';
import { signedUrls } from '../lib/data';

/** An image from a private bucket, via a short-lived signed URL. */
export default function Photo({ bucket, path, className, alt = '' }: { bucket: 'meal-photos' | 'flex-photos'; path: string; className?: string; alt?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const isDemo = import.meta.env.DEV && path.startsWith('demo');
  useEffect(() => {
    if (isDemo) return;
    let alive = true;
    signedUrls(bucket, [path]).then((m) => alive && setSrc(m[path] || null)).catch(() => undefined);
    return () => { alive = false; };
  }, [bucket, path, isDemo]);
  if (isDemo) {
    return (
      <div className={className} style={{ background: 'linear-gradient(135deg, #3a5a40, #a3b18a)', display: 'grid', placeItems: 'center', fontSize: 64 }} role="img" aria-label="صورة تجريبية">
        {path.includes('flex') ? '💪' : '🍗🍚🥗'}
      </div>
    );
  }
  return src ? <img className={className} src={src} alt={alt} loading="lazy" /> : <div className={className} style={{ background: 'var(--surface)' }} />;
}
