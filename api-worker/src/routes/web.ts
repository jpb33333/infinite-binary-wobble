import type { Env } from '../env.ts';
import { json, jsonError } from '../middleware.ts';
import { signToken } from '../lib/token.ts';
import { verifyStripeSignature } from '../lib/stripe.ts';
import { authenticate } from './auth.ts';

const TOKEN_TTL_SEC = 60 * 60 * 24 * 30; // 30 days

/**
 * Web bot-gate → device token. Verifies a Cloudflare Turnstile token, then mints
 * a signed HttpOnly device token + a `devices` row. (Implemented — needs only
 * the TURNSTILE_SECRET to run.)
 */
export async function handleWebSession(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { turnstileToken?: string };
  if (!body.turnstileToken) return jsonError(400, 'missing_turnstile_token');

  const ip = req.headers.get('CF-Connecting-IP');
  const verify = (await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      secret: env.TURNSTILE_SECRET,
      response: body.turnstileToken,
      ...(ip ? { remoteip: ip } : {}),
    }),
  })
    .then((r) => r.json())
    .catch(() => ({ success: false }))) as { success: boolean };
  if (!verify.success) return jsonError(403, 'turnstile_failed');

  const deviceId = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO devices (device_id, platform, created_at, last_seen)
     VALUES (?1, 'web', ?2, ?2)`,
  )
    .bind(deviceId, now)
    .run();

  const iat = Math.floor(now / 1000);
  const token = await signToken({ deviceId, iat, exp: iat + TOKEN_TTL_SEC }, env.TOKEN_SIGNING_KEY);
  const cookie = `ibw_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${TOKEN_TTL_SEC}`;
  return json({ ok: true, deviceId }, 200, { 'Set-Cookie': cookie });
}

/**
 * Create a Stripe hosted-Checkout session (pay-what-you-want ≥ $1) for the
 * authenticated device. STRIPE_PRICE_ID must reference a Price created with
 * custom_unit_amount enabled and a 100¢ minimum — the Checkout Sessions API
 * does not accept custom_unit_amount inline, so the Price is provisioned once
 * (see README.md). The session carries the device id in BOTH
 * client_reference_id and metadata so the webhook can resolve it. Unlock
 * happens ONLY in the verified webhook, never on the success_url redirect.
 */
export async function handleStripeCheckout(req: Request, env: Env): Promise<Response> {
  const auth = await authenticate(req, env);
  if (!auth) return jsonError(401, 'unauthenticated');
  if (!env.STRIPE_PRICE_ID) return jsonError(503, 'checkout_unconfigured');

  const params = new URLSearchParams({
    mode: 'payment',
    'line_items[0][price]': env.STRIPE_PRICE_ID,
    'line_items[0][quantity]': '1',
    client_reference_id: auth.deviceId,
    'metadata[device_id]': auth.deviceId,
    submit_type: 'donate',
    success_url: `${env.WEB_ORIGIN}/?checkout=success`,
    cancel_url: `${env.WEB_ORIGIN}/?checkout=cancel`,
  });
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params,
  }).catch(() => null);
  if (!res || !res.ok) return jsonError(502, 'stripe_unavailable');

  const session = (await res.json().catch(() => null)) as { id?: string; url?: string } | null;
  if (!session?.id || !session.url) return jsonError(502, 'stripe_bad_response');

  // Record the pending session so refunds/disputes can be traced back to the
  // device even if a later event's metadata were ever missing.
  await env.DB.prepare(
    `INSERT OR REPLACE INTO stripe_payments
       (session_id, device_id, payment_intent, amount_cents, currency, status, livemode, created_at)
     VALUES (?1, ?2, NULL, NULL, NULL, 'created', NULL, ?3)`,
  )
    .bind(session.id, auth.deviceId, Date.now())
    .run();

  return json({ url: session.url });
}

// The slice of a Stripe event this route consumes. Everything is optional —
// the payload is external input; missing fields degrade to a no-op, never to
// an unlock.
interface StripeEvent {
  id?: string;
  type?: string;
  livemode?: boolean;
  data?: {
    object?: {
      id?: string;
      client_reference_id?: string | null;
      metadata?: Record<string, string> | null;
      payment_intent?: string | null;
      amount_total?: number | null;
      currency?: string | null;
      payment_status?: string | null;
    };
  };
}

export async function handleStripeWebhook(req: Request, env: Env): Promise<Response> {
  // Verify authenticity from the RAW body before trusting any field — a forged
  // webhook must never unlock the game (threat-model P0). Implemented +
  // unit-tested (src/lib/stripe.ts, test/stripe.test.ts).
  const raw = await req.text();
  const valid = await verifyStripeSignature(
    raw,
    req.headers.get('Stripe-Signature'),
    env.STRIPE_WEBHOOK_SECRET,
  );
  if (!valid) return jsonError(400, 'invalid_signature');

  let event: StripeEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return jsonError(400, 'invalid_json');
  }
  if (!event.id) return jsonError(400, 'missing_event_id');

  // Idempotency: a replayed event (Stripe retries, operator resends) must not
  // double-apply. INSERT OR IGNORE + the changes count is atomic in D1.
  const dedupe = await env.DB.prepare(
    `INSERT OR IGNORE INTO processed_events (event_id, kind, received_at)
     VALUES (?1, 'stripe', ?2)`,
  )
    .bind(event.id, Date.now())
    .run();
  if (dedupe.meta.changes === 0) {
    return json({ received: true, duplicate: true });
  }

  // In production only live-mode events may move entitlements; test-mode
  // events flow end-to-end in non-production deploys so the whole loop can be
  // rehearsed against Stripe's test clock before real money is involved.
  const allowed = event.livemode === true || env.ENVIRONMENT !== 'production';

  const obj = event.data?.object ?? {};
  const now = Date.now();

  if (event.type === 'checkout.session.completed' && allowed) {
    const deviceId = obj.client_reference_id ?? obj.metadata?.device_id ?? null;
    const paid = obj.payment_status === 'paid';
    if (obj.id) {
      await env.DB.prepare(
        `INSERT OR REPLACE INTO stripe_payments
           (session_id, device_id, payment_intent, amount_cents, currency, status, livemode, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
        .bind(
          obj.id,
          deviceId,
          obj.payment_intent ?? null,
          obj.amount_total ?? null,
          obj.currency ?? null,
          paid ? 'paid' : (obj.payment_status ?? 'unknown'),
          event.livemode ? 1 : 0,
          now,
        )
        .run();
    }
    if (deviceId && paid) {
      await env.DB.prepare(
        `INSERT INTO entitlements (device_id, status, source, unlocked_at, updated_at)
         VALUES (?1, 'unlocked', 'stripe', ?2, ?2)
         ON CONFLICT(device_id) DO UPDATE SET
           status = 'unlocked', source = 'stripe', unlocked_at = ?2, updated_at = ?2`,
      )
        .bind(deviceId, now)
        .run();
    }
    return json({ received: true, applied: Boolean(deviceId && paid) });
  }

  if ((event.type === 'charge.refunded' || event.type === 'charge.dispute.created') && allowed) {
    // Resolve the device through the recorded payment_intent and re-lock it.
    const pi = obj.payment_intent ?? null;
    let applied = false;
    if (pi) {
      const row = await env.DB.prepare(
        `SELECT device_id FROM stripe_payments WHERE payment_intent = ?1`,
      )
        .bind(pi)
        .first<{ device_id: string | null }>();
      if (row?.device_id) {
        await env.DB.prepare(
          `UPDATE entitlements SET status = 'locked', updated_at = ?2
           WHERE device_id = ?1 AND source = 'stripe'`,
        )
          .bind(row.device_id, now)
          .run();
        applied = true;
      }
    }
    return json({ received: true, applied });
  }

  // Unhandled (or non-live in production) event types are acknowledged so
  // Stripe stops retrying; they were still recorded in processed_events.
  return json({ received: true, verified: true, type: event.type ?? null });
}
