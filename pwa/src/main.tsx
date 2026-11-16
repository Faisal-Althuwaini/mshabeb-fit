import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';

registerSW({ immediate: true });

// Keyboard open ⇒ hide the bottom tab bar (works even where CSS :has isn't supported).
const isField = (el: EventTarget | null) => el instanceof HTMLElement && el.matches('input:not([type=checkbox]):not([type=file]), textarea, select');
document.addEventListener('focusin', (e) => { if (isField(e.target)) document.documentElement.classList.add('kb-open'); });
document.addEventListener('focusout', () => setTimeout(() => { if (!isField(document.activeElement)) document.documentElement.classList.remove('kb-open'); }, 50));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
