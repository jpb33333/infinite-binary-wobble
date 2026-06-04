import type { Env } from '../env.ts';
import { json, jsonError, notImplemented } from '../middleware.ts';
import { signToken } from '../lib/token.ts';
import { verifyStripeSignature } from '../lib/stripe.ts';

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

export async function handleStripeCheckout(_req: Request, _env: Env): Promise<Response> {
  // TODO(stripe): authenticate the web token (authenticate()), then create a
  // Checkout Session via POST https://api.stripe.com/v1/checkout/sessions with
  // mode=payment, custom_unit_amount[minimum]=100 (pay-what-you-want ≥ $1),
  // client_reference_id=<deviceId>, metadata[device_id]=<deviceId>,
  // success_url/cancel_url back to the game. Return { url }; client redirects.
  return notImplemented('Stripe Checkout Session creation');
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

  let event: { id?: string; type?: string };
  try {
    event = JSON.parse(raw);
  } catch {
    return jsonError(400, 'invalid_json');
  }

  // TODO(stripe persistence): dedupe event.id in processed_events; on
  // checkout.session.completed (livemode) UPSERT entitlements(device_id from
  // client_reference_id → 'unlocked'); on charge.refunded / dispute.created →
  // 'locked'. Needs the D1 writes — the signature gate above is the
  // security-critical part and is done. Unlock happens ONLY here, never on the
  // client success_url redirect.
  return json({ received: true, verified: true, type: event.type ?? null });
}
