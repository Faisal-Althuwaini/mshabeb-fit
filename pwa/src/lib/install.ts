// Install-first (D30): new visitors install the PWA before signing up. iOS keeps a home-screen
// app's storage apart from Safari, and Web Push only works there, so signing up in the browser
// would mean signing in twice and no notifications.

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: BIPEvent | null = null;
const listeners = new Set<() => void>();

// Chrome/Edge/Samsung fire this early, often before React mounts: catch it at import time.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BIPEvent;
    listeners.forEach((f) => f());
  });
  window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach((f) => f()); });
}

export const canPrompt = () => !!deferred;
export const onPromptChange = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  listeners.forEach((f) => f());
  return outcome === 'accepted';
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export type Platform = 'ios-safari' | 'ios-other' | 'in-app' | 'android' | 'desktop';

export function platform(): Platform {
  const ua = navigator.userAgent;
  if (/FBAN|FBAV|Instagram|Line\/|Snapchat|TikTok|musical_ly|Twitter|LinkedInApp|GSA\//i.test(ua)) return 'in-app';
  if (/Android/i.test(ua)) return 'android';
  // iPadOS reports a Mac user agent; touch points give it away.
  const iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (iOS) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? 'ios-other' : 'ios-safari';
  return 'desktop';
}

const SKIP_KEY = 'install-gate-skipped';
export const skipped = () => { try { return localStorage.getItem(SKIP_KEY) === '1'; } catch { return false; } };
export const skip = () => { try { localStorage.setItem(SKIP_KEY, '1'); } catch { /* ignore */ } };
