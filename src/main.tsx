import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import App from './App.tsx';
import './styles.css';

const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

// NOTE: react-dom/client must be imported statically. A top-level-await
// dynamic import here deadlocks the built page: the client chunk circularly
// imports React internals from this entry chunk, which is still awaiting it.
if (typeof window !== 'undefined') {
  const target = document.getElementById('root')!;
  if (import.meta.env.DEV) {
    createRoot(target).render(app);
  } else {
    // Production HTML is prerendered at build time (vite-prerender-plugin);
    // hydrate instead of re-rendering so the crawlable markup is kept.
    hydrateRoot(target, app);
  }
}

/** Build-time hook for vite-prerender-plugin: renders the app to static
 * HTML so crawlers (and non-JS agents) see the real page content. The
 * dynamic import is safe here — this function never runs in the browser. */
export async function prerender() {
  const { renderToString } = await import('react-dom/server.edge');
  return { html: renderToString(app) };
}
