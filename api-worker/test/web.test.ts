import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleStripeWebhook, handleStripeCheckout, handleWebSession } from '../src/routes/web.ts';
import { handleStatus } from '../src/routes/play.ts';
import { signToken } from '../src/lib/token.ts';
import type { Env } from '../src/env.ts';

// In-memory stand-in for the D1 slice these routes touch. Dispatches on SQL
// substrings — if a route's SQL changes shape, the loud `unhandled sql` throw
// forces this fake to be updated alongside it.
function fakeDB() {
  const processed = new Set<string>();
  const entitlements = new Map<string, string>(); // device_id → status
  const payments = new Map<string, string | null>(); // payment_intent → device_id
  const devices = new Map<string, { last_seen: number }>(); // device_id → row
  const checkoutRows: { device: string; at: number }[] = []; // pending checkout mints
  const db = {
    processed,
    entitlements,
    payments,
    devices,
    // One-shot injected D1 failures — simulate transient hiccups in the money
    // path (entitlement write) and in the claim-release compensation (delete).
    failNextEntitlementWrite: false,
    failNextProcessedDelete: false,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              if (sql.includes('INTO processed_events')) {
                const id = String(args[0]);
                if (processed.has(id)) return { meta: { changes: 0 } };
                processed.add(id);
                return { meta: { changes: 1 } };
              }
              if (sql.includes('DELETE FROM processed_events')) {
                if (db.failNextProcessedDelete) {
                  db.failNextProcessedDelete = false;
                  throw new Error('D1_ERROR: injected delete failure');
                }
                const had = processed.delete(String(args[0]));
                return { meta: { changes: had ? 1 : 0 } };
              }
              if (sql.includes('INTO stripe_payments')) {
                // Two INSERT shapes share this substring: the webhook's 8-bind
                // full row and checkout's 3-bind pending row (?3 there is a
                // timestamp, NOT a payment_intent) — dispatch on arity so a
                // future assertion can't silently read garbage.
                if (args.length === 8) {
                  const pi = args[2] == null ? null : String(args[2]);
                  if (pi) payments.set(pi, args[1] == null ? null : String(args[1]));
                } else {
                  checkoutRows.push({ device: String(args[1]), at: Number(args[2]) });
                }
                return { meta: { changes: 1 } };
              }
              if (sql.includes('INTO entitlements')) {
                if (db.failNextEntitlementWrite) {
                  db.failNextEntitlementWrite = false;
                  throw new Error('D1_ERROR: injected transient write failure');
                }
                entitlements.set(String(args[0]), 'unlocked');
                return { meta: { changes: 1 } };
              }
              if (sql.includes('UPDATE entitlements')) {
                if (entitlements.has(String(args[0]))) {
                  entitlements.set(String(args[0]), 'locked');
                }
                return { meta: { changes: 1 } };
              }
              if (sql.includes('INTO devices')) {
                const id = String(args[0]);
                const existed = devices.has(id);
                if (!existed) devices.set(id, { last_seen: Number(args[1]) });
                return { meta: { changes: existed ? 0 : 1 } };
              }
              if (sql.includes('UPDATE devices SET last_seen')) {
                const row = devices.get(String(args[0]));
                if (!row) return { meta: { changes: 0 } };
                row.last_seen = Number(args[1]);
                return { meta: { changes: 1 } };
              }
              throw new Error(`unhandled sql (run): ${sql}`);
            },
            async first() {
              if (sql.includes('SELECT COUNT(*)') && sql.includes('FROM stripe_payments')) {
                const n = checkoutRows.filter(
                  r => r.device === String(args[0]) && r.at > Number(args[1]),
                ).length;
                return { n };
              }
              if (sql.includes('SELECT device_id FROM stripe_payments')) {
                const device = payments.get(String(args[0]));
                return device === undefined ? null : { device_id: device };
              }
              if (sql.includes('SELECT play_count FROM devices')) {
                return devices.has(String(args[0])) ? { play_count: 0 } : null;
              }
              if (sql.includes('SELECT status FROM entitlements')) {
                const status = entitlements.get(String(args[0]));
                return status === undefined ? null : { status };
              }
              throw new Error(`unhandled sql (first): ${sql}`);
            },
          };
        },
      };
    },
  };
  return db;
}

const WEBHOOK_SECRET = 'whsec_test_secret';
// Same format the deploy docs prescribe (`openssl rand -base64 32`).
const SIGNING_KEY = btoa('0123456789abcdef0123456789abcdef');
const enc = new TextEncoder();

async function stripeSig(payload: string, secret = WEBHOOK_SECRET): Promise<string> {
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`)));
  let hex = '';
  for (const b of sig) hex += b.toString(16).padStart(2, '0');
  return `t=${t},v1=${hex}`;
}

function makeEnv(db: ReturnType<typeof fakeDB>, environment = 'production'): Env {
  return {
    WEB_ORIGIN: 'https://play.example.com',
    FREE_PLAY_LIMIT: '100',
    ENVIRONMENT: environment,
    STRIPE_PRICE_ID: 'price_test_123',
    DB: db as unknown as Env['DB'],
    KV: {} as Env['KV'],
    STRIPE_SECRET_KEY: 'sk_test_secret',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    TURNSTILE_SECRET: 'turnstile-secret',
    TOKEN_SIGNING_KEY: SIGNING_KEY,
    APPLE_IAP_KEY: '',
    APPLE_KEY_ID: '',
    APPLE_ISSUER_ID: '',
  };
}

async function webhookRequest(event: object): Promise<Request> {
  const raw = JSON.stringify(event);
  return new Request('https://api.example.com/v1/stripe/webhook', {
    method: 'POST',
    headers: { 'Stripe-Signature': await stripeSig(raw) },
    body: raw,
  });
}

const completedEvent = (over: object = {}) => ({
  id: 'evt_1',
  type: 'checkout.session.completed',
  livemode: true,
  data: {
    object: {
      id: 'cs_1',
      client_reference_id: 'device-A',
      payment_intent: 'pi_1',
      amount_total: 500,
      currency: 'usd',
      payment_status: 'paid',
    },
  },
  ...over,
});

describe('handleStripeWebhook persistence', () => {
  it('unlocks the device on a paid live checkout.session.completed', async () => {
    const db = fakeDB();
    const res = await handleStripeWebhook(await webhookRequest(completedEvent()), makeEnv(db));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, applied: true });
    expect(db.entitlements.get('device-A')).toBe('unlocked');
    expect(db.payments.get('pi_1')).toBe('device-A');
  });

  it('is idempotent: a replayed event id is acknowledged but not re-applied', async () => {
    const db = fakeDB();
    const env = makeEnv(db);
    await handleStripeWebhook(await webhookRequest(completedEvent()), env);
    db.entitlements.delete('device-A'); // sentinel: a re-apply would restore it
    const res = await handleStripeWebhook(await webhookRequest(completedEvent()), env);
    expect(await res.json()).toMatchObject({ received: true, duplicate: true });
    expect(db.entitlements.has('device-A')).toBe(false);
  });

  it('never unlocks on an unpaid session', async () => {
    const db = fakeDB();
    const event = completedEvent();
    event.data.object.payment_status = 'unpaid';
    await handleStripeWebhook(await webhookRequest(event), makeEnv(db));
    expect(db.entitlements.has('device-A')).toBe(false);
  });

  it('ignores test-mode events in production', async () => {
    const db = fakeDB();
    await handleStripeWebhook(
      await webhookRequest(completedEvent({ livemode: false })),
      makeEnv(db, 'production'),
    );
    expect(db.entitlements.has('device-A')).toBe(false);
  });

  it('applies test-mode events outside production (sandbox rehearsal)', async () => {
    const db = fakeDB();
    await handleStripeWebhook(
      await webhookRequest(completedEvent({ livemode: false })),
      makeEnv(db, 'staging'),
    );
    expect(db.entitlements.get('device-A')).toBe('unlocked');
  });

  it('re-locks the device on charge.refunded via the recorded payment_intent', async () => {
    const db = fakeDB();
    const env = makeEnv(db);
    await handleStripeWebhook(await webhookRequest(completedEvent()), env);
    const refund = {
      id: 'evt_2',
      type: 'charge.refunded',
      livemode: true,
      data: { object: { id: 'ch_1', payment_intent: 'pi_1' } },
    };
    const res = await handleStripeWebhook(await webhookRequest(refund), env);
    expect(await res.json()).toMatchObject({ received: true, applied: true });
    expect(db.entitlements.get('device-A')).toBe('locked');
  });

  it('rejects a forged signature before touching the database', async () => {
    const db = fakeDB();
    const raw = JSON.stringify(completedEvent());
    const req = new Request('https://api.example.com/v1/stripe/webhook', {
      method: 'POST',
      headers: { 'Stripe-Signature': await stripeSig(raw, 'whsec_wrong') },
      body: raw,
    });
    const res = await handleStripeWebhook(req, makeEnv(db));
    expect(res.status).toBe(400);
    expect(db.processed.size).toBe(0);
    expect(db.entitlements.size).toBe(0);
  });
});

describe('handleStripeCheckout', () => {
  async function authedRequest(): Promise<Request> {
    const iat = Math.floor(Date.now() / 1000);
    const token = await signToken({ deviceId: 'device-A', iat, exp: iat + 3600 }, SIGNING_KEY);
    return new Request('https://api.example.com/v1/stripe/checkout', {
      method: 'POST',
      headers: { Cookie: `__Host-ibw_session=${token}` },
    });
  }

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.stripe.com/v1/checkout/sessions');
        const body = init?.body as URLSearchParams;
        expect(body.get('client_reference_id')).toBe('device-A');
        expect(body.get('line_items[0][price]')).toBe('price_test_123');
        return new Response(
          JSON.stringify({ id: 'cs_9', url: 'https://checkout.stripe.com/c/pay/cs_9' }),
          { status: 200 },
        );
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('requires an authenticated device', async () => {
    const res = await handleStripeCheckout(
      new Request('https://api.example.com/v1/stripe/checkout', { method: 'POST' }),
      makeEnv(fakeDB()),
    );
    expect(res.status).toBe(401);
  });

  it('creates a session and records the pending payment', async () => {
    const db = fakeDB();
    const res = await handleStripeCheckout(await authedRequest(), makeEnv(db));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_9' });
  });

  it('returns 502 when Stripe is unreachable, without unlocking anything', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 500 })));
    const db = fakeDB();
    const res = await handleStripeCheckout(await authedRequest(), makeEnv(db));
    expect(res.status).toBe(502);
    expect(db.entitlements.size).toBe(0);
  });

  it('rate-limits session minting per device — each mint is a Stripe call and a D1 row', async () => {
    const db = fakeDB();
    for (let i = 0; i < 5; i++) {
      expect((await handleStripeCheckout(await authedRequest(), makeEnv(db))).status).toBe(200);
    }
    const res = await handleStripeCheckout(await authedRequest(), makeEnv(db));
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe('rate_limited');
  });
});

describe('handleWebSession device identity', () => {
  beforeEach(() => {
    // Turnstile siteverify always succeeds in these tests; what's under test
    // is device identity, not the bot gate.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        expect(String(url)).toContain('challenges.cloudflare.com/turnstile');
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  function sessionRequest(cookie?: string): Request {
    return new Request('https://api.example.com/v1/web/session', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { Cookie: `__Host-ibw_session=${cookie}` } : {}),
      },
      body: JSON.stringify({ turnstileToken: 'tok_test' }),
    });
  }

  function cookieFrom(res: Response): string {
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    const m = /__Host-ibw_session=([^;]+)/.exec(setCookie);
    expect(m, 'expected a Set-Cookie with __Host-ibw_session').toBeTruthy();
    return m![1];
  }

  it('mints a new device when no session cookie is presented', async () => {
    const db = fakeDB();
    const res = await handleWebSession(sessionRequest(), makeEnv(db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; deviceId: string };
    expect(body.ok).toBe(true);
    expect(db.devices.has(body.deviceId)).toBe(true);
    expect(db.devices.size).toBe(1);
    cookieFrom(res); // HttpOnly token issued
  });

  it('reuses the existing device when a valid session cookie is presented', async () => {
    // The play counter and any paid entitlement hang off the device id. If a
    // second /v1/web/session call mints a fresh device, every page reload
    // resets the meter — and a paying customer returning from Stripe's
    // ?checkout=success redirect loses the entitlement the webhook just
    // attached to their old device. The same cookie must keep the same device.
    const db = fakeDB();
    const env = makeEnv(db);
    const first = await handleWebSession(sessionRequest(), env);
    const firstId = ((await first.json()) as { deviceId: string }).deviceId;
    const token = cookieFrom(first);

    db.devices.get(firstId)!.last_seen = 0; // sentinel: reuse must bump it
    const second = await handleWebSession(sessionRequest(token), env);
    expect(second.status).toBe(200);
    const secondId = ((await second.json()) as { deviceId: string }).deviceId;
    expect(secondId).toBe(firstId);
    expect(db.devices.size).toBe(1);
    expect(db.devices.get(firstId)!.last_seen).toBeGreaterThan(0);
    // Sliding renewal: the reuse path re-issues a fresh full-TTL cookie.
    cookieFrom(second);
    expect(second.headers.get('Set-Cookie')).toContain('Max-Age=2592000');
  });

  it('denies device creation when Turnstile rejects the token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 })),
    );
    const db = fakeDB();
    const res = await handleWebSession(sessionRequest(), makeEnv(db));
    expect(res.status).toBe(403);
    expect(db.devices.size).toBe(0);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('ignores a forged cookie and falls through to the Turnstile mint path', async () => {
    // A token signed with the wrong key must not select the reuse path — the
    // asserted device id comes from an attacker, not from us. The request
    // should behave exactly like a cookie-less one: bot check + fresh device.
    const db = fakeDB();
    const forged = await signToken(
      { deviceId: 'device-evil', iat: 0, exp: Math.floor(Date.now() / 1000) + 3600 },
      btoa('another-key-another-key-another!'),
    );
    const res = await handleWebSession(sessionRequest(forged), makeEnv(db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deviceId: string };
    expect(body.deviceId).not.toBe('device-evil');
    expect(db.devices.has('device-evil')).toBe(false);
    expect(db.devices.size).toBe(1);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1); // Turnstile was consulted
  });

  it('re-adopts a valid cookie whose device row is missing from D1', async () => {
    // A signed cookie can outlive its row (manual cleanup, migration). The
    // session endpoint should restore the row under the SAME device id rather
    // than minting a new identity — otherwise /v1/play/increment 500s on
    // unknown_device for an otherwise-valid session.
    const db = fakeDB();
    const iat = Math.floor(Date.now() / 1000);
    const token = await signToken({ deviceId: 'device-X', iat, exp: iat + 3600 }, SIGNING_KEY);
    const res = await handleWebSession(sessionRequest(token), makeEnv(db));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { deviceId: string }).deviceId).toBe('device-X');
    expect(db.devices.has('device-X')).toBe(true);
  });

  it('still requires a Turnstile token when no valid cookie exists', async () => {
    const req = new Request('https://api.example.com/v1/web/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await handleWebSession(req, makeEnv(fakeDB()));
    expect(res.status).toBe(400);
  });
});

describe('handleStripeWebhook retry safety', () => {
  it('releases the idempotency claim when the entitlement write fails, so a Stripe retry applies it', async () => {
    // Money-path invariant: a transient D1 failure between "event recorded"
    // and "entitlement written" must NOT permanently skip the unlock. The
    // failed attempt should surface an error (Stripe retries on 5xx) and the
    // retry must actually apply — paid customers never stay locked.
    const db = fakeDB();
    const env = makeEnv(db);
    db.failNextEntitlementWrite = true;
    await expect(handleStripeWebhook(await webhookRequest(completedEvent()), env)).rejects.toThrow();
    expect(db.entitlements.has('device-A')).toBe(false);

    const retry = await handleStripeWebhook(await webhookRequest(completedEvent()), env);
    expect(await retry.json()).toMatchObject({ received: true, applied: true });
    expect(db.entitlements.get('device-A')).toBe('unlocked');
  });

  it('surfaces the apply error (not the release error) when the claim release also fails', async () => {
    // Documented residual risk: if BOTH the apply and the compensating delete
    // fail (one D1 outage), the event stays permanently claimed — the retry
    // hits the duplicate path. What must hold: the ORIGINAL apply error is the
    // one that propagates (the release failure is logged, not thrown).
    const db = fakeDB();
    const env = makeEnv(db);
    db.failNextEntitlementWrite = true;
    db.failNextProcessedDelete = true;
    await expect(
      handleStripeWebhook(await webhookRequest(completedEvent()), env),
    ).rejects.toThrow(/transient write failure/);

    const retry = await handleStripeWebhook(await webhookRequest(completedEvent()), env);
    expect(await retry.json()).toMatchObject({ received: true, duplicate: true });
    expect(db.entitlements.has('device-A')).toBe(false);
  });
});

describe('status endpoint contract', () => {
  it('returns 401 without a session cookie — the signal the web client uses to mint a session', async () => {
    const res = await handleStatus(
      new Request('https://api.example.com/v1/status'),
      makeEnv(fakeDB()),
    );
    expect(res.status).toBe(401);
  });
});
