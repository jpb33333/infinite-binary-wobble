import { describe, it, expect } from 'vitest';
import { verifyStripeSignature } from '../src/lib/stripe.ts';

const SECRET = 'whsec_test_secret';
const enc = new TextEncoder();

async function sign(payload: string, t: number, secret = SECRET): Promise<string> {
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

describe('verifyStripeSignature', () => {
  const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
  const now = 1_700_000_000;

  it('accepts a valid signature within tolerance', async () => {
    const header = await sign(payload, now);
    expect(await verifyStripeSignature(payload, header, SECRET, { nowSec: now })).toBe(true);
  });

  it('rejects a tampered payload', async () => {
    const header = await sign(payload, now);
    expect(await verifyStripeSignature(`${payload}x`, header, SECRET, { nowSec: now })).toBe(false);
  });

  it('rejects a stale timestamp (replay defense)', async () => {
    const header = await sign(payload, now - 1000);
    expect(await verifyStripeSignature(payload, header, SECRET, { nowSec: now })).toBe(false);
  });

  it('rejects a wrong secret', async () => {
    const header = await sign(payload, now, 'whsec_wrong');
    expect(await verifyStripeSignature(payload, header, SECRET, { nowSec: now })).toBe(false);
  });

  it('rejects a missing or v1-less header', async () => {
    expect(await verifyStripeSignature(payload, null, SECRET, { nowSec: now })).toBe(false);
    expect(await verifyStripeSignature(payload, 't=1,v0=abc', SECRET, { nowSec: now })).toBe(false);
  });
});
