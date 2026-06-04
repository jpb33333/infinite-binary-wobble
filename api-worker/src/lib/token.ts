/**
 * Compact signed token for the web device identity (carried in an HttpOnly
 * cookie). HMAC-SHA256 over a JSON payload; format `base64url(payload).base64url(sig)`.
 * Uses Web Crypto, which exists in both the Workers runtime and Node 22 — so the
 * unit tests run unchanged. Verification uses crypto.subtle.verify (constant-time).
 */
export interface TokenPayload {
  deviceId: string;
  iat: number; // epoch seconds
  exp: number; // epoch seconds
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function stdB64Decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(keyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    stdB64Decode(keyB64),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signToken(payload: TokenPayload, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
  return `${body}.${b64urlEncode(sig)}`;
}

export async function verifyToken(
  token: string,
  keyB64: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<TokenPayload | null> {
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const key = await importKey(keyB64);
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', key, b64urlDecode(sig), enc.encode(body));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    const payload = JSON.parse(dec.decode(b64urlDecode(body))) as TokenPayload;
    if (typeof payload.exp !== 'number' || payload.exp < nowSec) return null;
    return payload;
  } catch {
    return null;
  }
}
