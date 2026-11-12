// Appearance: dark (default) / light / auto (follows the iPhone setting).
export type Theme = 'dark' | 'light' | 'auto';

export function getTheme(): Theme {
  try { return (localStorage.getItem('theme') as Theme) || 'dark'; } catch { return 'dark'; }
}

export function setTheme(t: Theme) {
  try { localStorage.setItem('theme', t); } catch { /* private mode */ }
  document.documentElement.setAttribute('data-theme', t);
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0e0e0d' : '#ffffff');
}
