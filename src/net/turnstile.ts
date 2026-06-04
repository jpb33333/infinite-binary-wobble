// Cloudflare Turnstile loader. Resolves a token, or null if Turnstile isn't
// configured or fails — callers treat null as "no session" and stay inert, so
// a Turnstile hiccup never blocks the game. The widget script + its iframe load
// from challenges.cloudflare.com, which the strict CSP must allow when metering
// is enabled (script-src + frame-src) — documented as a deploy step.

interface TurnstileApi {
  render(
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      'error-callback'?: () => void;
      size?: 'normal' | 'flexible' | 'compact';
    },
  ): string;
}

function getApi(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile;
}

let scriptPromise: Promise<TurnstileApi | null> | null = null;

function loadScript(): Promise<TurnstileApi | null> {
  const existing = getApi();
  if (existing) return Promise.resolve(existing);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise(resolve => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve(getApi() ?? null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export function getTurnstileToken(siteKey: string, timeoutMs = 15000): Promise<string | null> {
  if (!siteKey) return Promise.resolve(null);
  return new Promise(resolve => {
    let done = false;
    const finish = (v: string | null): void => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    void loadScript().then(api => {
      if (!api) {
        clearTimeout(timer);
        finish(null);
        return;
      }
      const host = document.createElement('div');
      host.style.position = 'fixed';
      host.style.right = '12px';
      host.style.bottom = '12px';
      host.style.zIndex = '2147483647';
      document.body.appendChild(host);
      const cleanup = (): void => {
        clearTimeout(timer);
        host.remove();
      };
      api.render(host, {
        sitekey: siteKey,
        size: 'flexible',
        callback: (token: string) => {
          cleanup();
          finish(token);
        },
        'error-callback': () => {
          cleanup();
          finish(null);
        },
      });
    });
  });
}
