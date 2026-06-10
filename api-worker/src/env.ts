/**
 * Bindings + secrets available to the Worker at runtime.
 * Mirrors `wrangler.toml` ([vars], bindings) plus the `wrangler secret put` set.
 */
export interface Env {
  // [vars]
  WEB_ORIGIN: string;
  FREE_PLAY_LIMIT: string;
  ENVIRONMENT: string;
  // Stripe Price with custom_unit_amount enabled (pay-what-you-want >= $1).
  // A resource id, not a secret - created once during provisioning.
  STRIPE_PRICE_ID: string;

  // Bindings
  DB: D1Database;
  KV: KVNamespace;
  // COUNTER?: DurableObjectNamespace; // optional DO upgrade (see wrangler.toml)

  // Secrets (set via `wrangler secret put <NAME>`) — never in source/config.
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  TURNSTILE_SECRET: string;
  TOKEN_SIGNING_KEY: string;
  APPLE_IAP_KEY: string;
  APPLE_KEY_ID: string;
  APPLE_ISSUER_ID: string;
}
