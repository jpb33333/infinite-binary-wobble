import type { Env } from '../env.ts';
import { notImplemented } from '../middleware.ts';

/**
 * iOS routes. These need Apple's crypto formats + your App Store Connect key, so
 * they ship as precise stubs (the contract is real; the clients can be built
 * against it). Each documents the exact verification steps.
 */

export async function handleAttestRegister(_req: Request, _env: Env): Promise<Response> {
  // TODO(ios) App Attest registration:
  // 1. Issue a one-time challenge nonce (KV, short TTL); client attests over it.
  // 2. Receive the CBOR attestation object + keyId.
  // 3. Verify: x5c chain → Apple App Attest Root CA; the nonce in cred-cert
  //    extension 1.2.840.113635.100.8.2 == SHA256(authData ‖ clientDataHash);
  //    rpIdHash == SHA256("<TeamID>.<BundleID>"); aaguid ∈ {appattest, appattestdevelop};
  //    signCount == 0; credentialId == keyId.
  // 4. Store the public key → INSERT devices(platform='ios', attest_pubkey,
  //    assertion_count=0); return an opaque device_id.
  return notImplemented('App Attest attestation verification');
}

export async function handleIapVerify(_req: Request, _env: Env): Promise<Response> {
  // TODO(ios) StoreKit 2 instant-unlock:
  // Validate the signed transaction JWS (x5c → Apple root; bundleId; productId ∈
  // your tiers; environment matches prod). Cross-check via the App Store Server API
  // (Get Transaction Info), authenticating with an ES256 JWT signed by
  // APPLE_IAP_KEY (APPLE_KEY_ID / APPLE_ISSUER_ID). Then UPSERT
  // entitlements(status='unlocked', source='apple', original_txn_id).
  return notImplemented('StoreKit 2 transaction verification');
}

export async function handleAppleNotifications(_req: Request, _env: Env): Promise<Response> {
  // TODO(ios) App Store Server Notifications V2 (authoritative entitlement):
  // Verify the signed JWS (x5c → Apple root); decode signedPayload.notificationType;
  // dedupe notificationUUID in processed_events; map REFUND / REVOKE →
  // entitlements.status='locked', (re)purchase/subscribe → 'unlocked'.
  return notImplemented('App Store Server Notifications V2');
}
