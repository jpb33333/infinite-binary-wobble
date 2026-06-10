import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// src/net/config.ts reads import.meta.env at module load, so every test stubs
// the env FIRST, resets the module graph, then imports a fresh Meter — the
// same way a real build inlines the values.
async function loadMeter() {
  vi.resetModules();
  const mod = await import('../src/net/meter.ts');
  return new mod.Meter();
}

const gate = (over: object = {}) => ({
  plays: 0,
  remaining: 100,
  locked: false,
  entitled: false,
  ...over,
});
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('Meter with metering enabled', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test');
    // Default: no Turnstile key, so the session path stays inert without
    // touching the DOM (also the production posture if the key goes missing).
    // The first-visit test overrides this and mocks the turnstile module.
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock('../src/net/turnstile.ts');
  });

  it('boots refresh-first: an existing session answers /v1/status with no session mint', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        calls.push(String(url));
        return ok(gate({ plays: 3, remaining: 97 }));
      }),
    );
    const meter = await loadMeter();
    await meter.init();
    // Exactly one call, and it is NOT /v1/web/session — a reload must reuse
    // the device (its play count and any paid unlock), not re-run Turnstile.
    expect(calls).toEqual(['https://api.test/v1/status']);
    expect(meter.view.remaining).toBe(97);
    expect(meter.shouldGate()).toBe(false);
  });

  it('first visit: 401 → Turnstile session mint → refreshed status, in that order', async () => {
    // The headline contract of the refresh-first design, end to end: the
    // widget runs ONLY after the server says 401, and the status is re-read
    // through the fresh session.
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site_test');
    vi.doMock('../src/net/turnstile.ts', () => ({
      getTurnstileToken: vi.fn(async () => 'tok_widget'),
    }));
    const calls: string[] = [];
    let statusCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url);
        calls.push(u);
        if (u.endsWith('/v1/status')) {
          statusCalls += 1;
          return statusCalls === 1
            ? new Response('', { status: 401 })
            : ok(gate({ plays: 1, remaining: 99 }));
        }
        if (u.endsWith('/v1/web/session')) return ok({ ok: true, deviceId: 'd1' });
        throw new Error(`unexpected url ${u}`);
      }),
    );
    const meter = await loadMeter();
    await meter.init();
    expect(calls).toEqual([
      'https://api.test/v1/status',
      'https://api.test/v1/web/session',
      'https://api.test/v1/status',
    ]);
    expect(meter.view.remaining).toBe(99);
  });

  it('gates only on a positive server "locked and not entitled" answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok(gate({ plays: 100, remaining: 0, locked: true }))),
    );
    const meter = await loadMeter();
    await meter.init();
    expect(meter.shouldGate()).toBe(true);
  });

  it('never gates an entitled (paid) device', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok(gate({ plays: 250, remaining: null, locked: false, entitled: true }))),
    );
    const meter = await loadMeter();
    await meter.init();
    expect(meter.shouldGate()).toBe(false);
    expect(meter.view.unlocked).toBe(true);
  });

  it('un-latches the paywall gate when the session expires mid-visit', async () => {
    // Fail-open invariant: a player parked on the paywall when the 30-day
    // cookie lapses must not be trapped there — the 401 clears the cached
    // lock and the game plays on (the next boot mints a fresh device anyway).
    let status = 200;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        status === 200
          ? ok(gate({ plays: 100, remaining: 0, locked: true }))
          : new Response('', { status }),
      ),
    );
    const meter = await loadMeter();
    await meter.init();
    expect(meter.shouldGate()).toBe(true);
    status = 401;
    await meter.refresh();
    expect(meter.shouldGate()).toBe(false);
  });

  it('fails open on 401 when no session can be minted (Turnstile unavailable)', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        calls.push(String(url));
        return new Response('', { status: 401 });
      }),
    );
    const meter = await loadMeter();
    await meter.init();
    // 401 triggers the session path; with no site key it goes inert without
    // ever blocking the game.
    expect(calls).toEqual(['https://api.test/v1/status']);
    expect(meter.shouldGate()).toBe(false);
  });

  it('fails open on network errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down');
      }),
    );
    const meter = await loadMeter();
    await meter.init();
    meter.consumePlay();
    expect(meter.shouldGate()).toBe(false);
  });

  it('fails open on server errors (5xx) without touching cached state', async () => {
    let status = 200;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        status === 200 ? ok(gate({ plays: 10, remaining: 90 })) : new Response('', { status }),
      ),
    );
    const meter = await loadMeter();
    await meter.init();
    expect(meter.view.remaining).toBe(90);
    status = 503;
    await meter.refresh();
    expect(meter.view.remaining).toBe(90); // unchanged — a flaky server never gates
    expect(meter.shouldGate()).toBe(false);
  });

  it('fails open on a malformed 200 body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not-json{', { status: 200 })));
    const meter = await loadMeter();
    await meter.init();
    expect(meter.view.remaining).toBeNull();
    expect(meter.shouldGate()).toBe(false);
  });

  it('consumePlay applies the increment response but freezes state when unauthenticated', async () => {
    let status = 200;
    const fetchSpy = vi.fn(async (url: RequestInfo | URL) => {
      if (status !== 200) return new Response('', { status });
      // Distinct payloads per endpoint so the assertion can only be satisfied
      // by consumePlay actually applying the increment response.
      return String(url).endsWith('/v1/play/increment')
        ? ok(gate({ plays: 42, remaining: 58 }))
        : ok(gate({ plays: 41, remaining: 59 }));
    });
    vi.stubGlobal('fetch', fetchSpy);
    const meter = await loadMeter();
    await meter.init();
    expect(meter.view.remaining).toBe(59);
    meter.consumePlay();
    await vi.waitFor(() => expect(meter.view.remaining).toBe(58));
    status = 401; // session expired mid-game: stays fail-open, state untouched
    meter.consumePlay();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));
    expect(meter.view.remaining).toBe(58);
    expect(meter.shouldGate()).toBe(false);
  });
});

describe('Meter with metering disabled (the shipping default)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('makes zero network calls when VITE_API_BASE_URL is unset', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const meter = await loadMeter();
    await meter.init();
    await meter.refresh();
    meter.consumePlay();
    expect(spy).not.toHaveBeenCalled();
    expect(meter.shouldGate()).toBe(false);
    expect(meter.view.enabled).toBe(false);
  });
});
