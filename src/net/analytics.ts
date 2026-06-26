// Google Analytics 4 (gtag.js) — play analytics, feature-usage, and production
// error tracking. Inert unless a Measurement ID is configured at build time
// (VITE_GA_MEASUREMENT_ID), exactly like the metering layer: dev and the default
// build load nothing, fire nothing, and set no cookies. Fail-open everywhere —
// a gtag hiccup never touches the game.
//
// When you enable it, the build-time CSP widening (cspWiden in vite.config.ts)
// allows googletagmanager.com (the script) + *.google-analytics.com (the data).

const GA_ID = import.meta.env.VITE_GA_MEASUREMENT_ID ?? '';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let ready = false;

export function initAnalytics(): void {
  if (!GA_ID || ready) return;
  try {
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer ?? [];
    window.gtag = (...args: unknown[]) => {
      window.dataLayer!.push(args);
    };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID, { anonymize_ip: true });
    ready = true;
    installErrorTracking();
  } catch {
    // fail-open — analytics must never break the game
  }
}

// Surface production JS errors as GA `exception` events (basic: message +
// location, no stack/source-maps — a dedicated tool like Sentry would give more,
// but this catches "errors are happening, and here's the message" for free).
function installErrorTracking(): void {
  window.addEventListener('error', (e) => {
    track('exception', {
      description: `${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`,
      fatal: false,
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    const desc = r instanceof Error ? `${r.name}: ${r.message}` : String(r).slice(0, 200);
    track('exception', { description: `unhandled: ${desc}`, fatal: false });
  });
}

export function track(event: string, params?: Record<string, unknown>): void {
  if (!ready || !window.gtag) return;
  try {
    window.gtag('event', event, params ?? {});
  } catch {
    // fail-open
  }
}
