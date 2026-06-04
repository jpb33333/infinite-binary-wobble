import { describe, it, expect } from 'vitest';
import { signToken, verifyToken } from '../src/lib/token.ts';

// 32-byte key, standard base64 (as TOKEN_SIGNING_KEY would be).
const KEY = btoa('test-signing-key-thirty-two-byte');
const OTHER = btoa('a-totally-different-32-byte-key!!');

describe('web device token', () => {
  it('round-trips a valid token', async () => {
    const now = 1_000_000;
    const t = await signToken({ deviceId: 'dev-1', iat: now, exp: now + 100 }, KEY);
    const p = await verifyToken(t, KEY, now + 1);
    expect(p?.deviceId).toBe('dev-1');
  });

  it('rejects a tampered payload', async () => {
    const now = 1_000_000;
    const t = await signToken({ deviceId: 'dev-1', iat: now, exp: now + 100 }, KEY);
    const tampered = `${'A'.repeat(t.indexOf('.'))}${t.slice(t.indexOf('.'))}`;
    expect(await verifyToken(tampered, KEY, now + 1)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const now = 1_000_000;
    const t = await signToken({ deviceId: 'dev-1', iat: now, exp: now + 100 }, KEY);
    expect(await verifyToken(t, KEY, now + 1000)).toBeNull();
  });

  it('rejects a token signed with a different key', async () => {
    const now = 1_000_000;
    const t = await signToken({ deviceId: 'dev-1', iat: now, exp: now + 100 }, KEY);
    expect(await verifyToken(t, OTHER, now + 1)).toBeNull();
  });
});
