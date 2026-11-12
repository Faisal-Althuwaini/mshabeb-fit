import { createClient, type SupportedStorage } from '@supabase/supabase-js';
import { get, set, del } from 'idb-keyval';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anon) {
  // eslint-disable-next-line no-console
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
}

/**
 * "Stay logged in forever": the session is written to BOTH localStorage and IndexedDB.
 * If iOS ever clears one of them, the other restores it, and the refresh token (which never
 * expires on this project: no time-box, no inactivity timeout) gets you a fresh session.
 * Only an explicit «تسجيل خروج» removes it.
 */
const durableStorage: SupportedStorage = {
  async getItem(key) {
    let v: string | null = null;
    try { v = localStorage.getItem(key); } catch { /* blocked */ }
    if (v != null) return v;
    try {
      const backup = (await get(`auth:${key}`)) as string | undefined;
      if (backup != null) {
        try { localStorage.setItem(key, backup); } catch { /* blocked */ }
        return backup;
      }
    } catch { /* IndexedDB unavailable */ }
    return null;
  },
  async setItem(key, value) {
    try { localStorage.setItem(key, value); } catch { /* blocked */ }
    try { await set(`auth:${key}`, value); } catch { /* IndexedDB unavailable */ }
  },
  async removeItem(key) {
    try { localStorage.removeItem(key); } catch { /* blocked */ }
    try { await del(`auth:${key}`); } catch { /* IndexedDB unavailable */ }
  },
};

export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: durableStorage,
  },
});

/** Ask the browser not to evict this app's storage (login, offline queue, cache). */
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* not supported */ }
}

// When the app comes back to the foreground (iOS resumes a frozen PWA), refresh right away
// instead of waiting for the next timer tick.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
