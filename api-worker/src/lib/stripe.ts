// Stripe webhook signature verification — the #1 payment-integrity control
// (a forged "paid" webhook must NOT unlock the game). Mirrors Stripe's
// constructEvent check by hand with Web Crypto, since the Stripe SDK's Node
// crypto isn't available in the Workers runtime.
//
// Header format: `Stripe-Signature: t=<unixSecs>,v1=<hexHmac>[,v1=<...>]`.
// Valid iff some v1 == HMAC_SHA256(secret, `${t}.${rawBody}`) AND |now-t| <= tolerance.

const enc = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

// Length-independent compare on equal-length hex strings — avoids leaking the
// match position via timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message))));
}

export interface StripeSigOptions {
  toleranceSec?: number;
  nowSec?: number;
}

export async function verifyStripeSignature(
  payload: string,
  sigHeader: string | null,
  secret: string,
  opts: StripeSigOptions = {},
): Promise<boolean> {
  if (!sigHeader || !secret) return false;
  const tolerance = opts.toleranceSec ?? 300;
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);

  let t: number | null = null;
  const v1: string[] = [];
  for (const part of sigHeader.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === 't') t = Number(v);
    else if (k === 'v1') v1.push(v);
  }
  if (t === null || !Number.isFinite(t) || v1.length === 0) return false;
  if (Math.abs(now - t) > tolerance) return false; // replay / stale

  const expected = await hmacHex(secret, `${t}.${payload}`);
  return v1.some(sig => timingSafeEqual(sig, expected));
}
