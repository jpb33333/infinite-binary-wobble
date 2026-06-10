import type { Env } from '../env.ts';
import { verifyToken } from '../lib/token.ts';

export interface AuthResult {
  deviceId: string;
  platform: 'web' | 'ios';
}

/**
 * Authenticate a metered request and resolve its device.
 * - **Web (implemented):** the HttpOnly signed device-token cookie.
 * - **iOS (stub):** an App Attest assertion in `X-Attest-*` headers. Verification
 *   is a documented TODO; until then it **fails closed** (never fail open).
 */
export async function authenticate(req: Request, env: Env): Promise<AuthResult | null> {
  if (req.headers.get('X-Attest-Key-Id')) {
    // TODO(ios): load the stored public key for this keyId, verify the assertion
    // signature over SHA256(body ‖ server-nonce), enforce a strictly-increasing
    // signCount (replay defense), then resolve the device_id. Reject until done.
    return null;
  }
  // __Host- prefix: the browser refuses to store it unless Secure, Path=/ and
  // no Domain attribute — so a script on a sibling subdomain (the documented
  // deploy model is play.X + api.X on one registrable domain) cannot plant or
  // shadow it, closing the session-fixation angle for free.
  const token = readCookie(req, '__Host-ibw_session');
  if (!token) return null;
  const payload = await verifyToken(token, env.TOKEN_SIGNING_KEY);
  if (!payload) return null;
  return { deviceId: payload.deviceId, platform: 'web' };
}

function readCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get('Cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}
