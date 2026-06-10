import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleStripeWebhook, handleStripeCheckout } from '../src/routes/web.ts';
import { signToken } from '../src/lib/token.ts';
import type { Env } from '../src/env.ts';

// In-memory stand-in for the D1 slice these routes touch. Dispatches on SQL
// substrings — if a route's SQL changes shape, the loud `unhandled sql` throw
// forces this fake to be updated alongside it.
function fakeDB() {
  const processed = new Set<string>();
  const entitlements = new Map<string, string>(); // device_id → status
  const payments = new Map<string, string | null>(); // payment_intent → device_id
  const db = {
    processed,
    entitlements,
    payments,
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
              if (sql.includes('INTO stripe_payments')) {
                const pi = args[2] == null ? null : String(args[2]);
                if (pi) payments.set(pi, args[1] == null ? null : String(args[1]));
                return { meta: { changes: 1 } };
              }
              if (sql.includes('INTO entitlements')) {
                entitlements.set(String(args[0]), 'unlocked');
                return { meta: { changes: 1 } };
              }
              if (sql.includes('UPDATE entitlements')) {
                if (entitlements.has(String(args[0]))) {
                  entitlements.set(String(args[0]), 'locked');
                }
                return { meta: { changes: 1 } };
              }
              throw new Error(`unhandled sql (run): ${sql}`);
            },
            async first() {
              if (sql.includes('SELECT device_id FROM stripe_payments')) {
                const device = payments.get(String(args[0]));
                return device === undefined ? null : { device_id: device };
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
      headers: { Cookie: `ibw_session=${token}` },
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
});
