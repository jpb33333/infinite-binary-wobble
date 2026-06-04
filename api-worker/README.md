# IBW API Worker

The Cloudflare Worker that is the **trust root** for Infinite Binary Wobble's
metering + payments. Shared by the web game and the native iOS app.

See the full design in `../docs/` and the approved plan; this README is the
operational summary.

## What it does

- Holds the **play count** server-side (free tier = `FREE_PLAY_LIMIT`, default 100).
- **iOS:** verifies Apple **App Attest** (device authenticity) and **StoreKit 2**
  purchases; consumes **App Store Server Notifications V2** for refund/revoke.
- **Web:** issues a signed, HttpOnly device token behind **Cloudflare Turnstile**,
  and unlocks via **Stripe** pay-what-you-want — only on a **signature-verified
  webhook**, never a client claim.
- `entitlement` is always a **server-derived view of current payment state**.

> **Honest limitation — web metering is best-effort.** A web client can clear
> cookies / edit JS to re-earn free plays. Turnstile + rate limits raise the
> cost but cannot prevent it. The *enforceable* paywall is iOS (App Attest).
> The web paywall is a goodwill nudge, which fits pay-what-you-want.

## Status (this scaffold)

| Implemented (pure logic, testable) | Stubbed (needs secrets/SDKs — marked `TODO`) |
|---|---|
| Router, CORS lock, security headers, error wrapper | Stripe webhook signature verification + Checkout |
| `gate.ts` free/locked decision | App Attest attestation + assertion verification |
| `token.ts` HMAC sign/verify (Web Crypto) | StoreKit 2 JWS + App Store Server API + ASSN V2 |
| `counter.ts` D1 atomic increment | Turnstile siteverify |
| D1 `schema.sql`, `/health`, `/v1/status` | — |

Stubs return `501 Not Implemented` with the exact verification steps documented
inline, so the contract is real and the clients can be built against it.

## Endpoints (`/v1`)

| Method · Path | Auth | Purpose |
|---|---|---|
| `GET  /health` | none | Liveness. |
| `GET  /v1/status` | token / assertion | `{ plays, remaining, locked, entitled }`. |
| `POST /v1/play/increment` | token / assertion | Atomic increment; the only gate. |
| `POST /v1/web/session` | Turnstile | Mint HttpOnly signed device token. |
| `POST /v1/stripe/checkout` | token | Create hosted Checkout (PWYW ≥ $1). |
| `POST /v1/stripe/webhook` | Stripe sig | Verified unlock. |
| `POST /v1/attest/register` | App Attest | Register iOS device key. |
| `POST /v1/iap/verify` | assertion + JWS | Instant iOS unlock. |
| `POST /v1/apple/notifications` | Apple JWS | Authoritative iOS entitlement. |

## Deploy (you provision these — see also `../.claude/plans/`)

Prerequisites: a **Cloudflare account**, a **custom domain** on Cloudflare, a
**Stripe account**, and **Apple** App Store Connect IAP key + App Attest.

```sh
npm install
npx wrangler login

# 1. Create the data stores, paste the returned IDs into wrangler.toml
npx wrangler d1 create ibw
npx wrangler kv namespace create ibw-kv
npm run db:init                      # apply schema.sql to D1

# 2. Set WEB_ORIGIN in wrangler.toml to your site (e.g. https://play.yourdomain)

# 3. Load secrets (values never touch the repo)
for s in STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET TURNSTILE_SECRET \
         TOKEN_SIGNING_KEY APPLE_IAP_KEY APPLE_KEY_ID APPLE_ISSUER_ID; do
  npx wrangler secret put "$s"
done

# 4. Ship
npm run typecheck && npm test
npm run deploy
```

Then point Stripe's webhook at `https://api.<domain>/v1/stripe/webhook` and
Apple's Server Notifications V2 URL at `https://api.<domain>/v1/apple/notifications`.

For local dev, copy `.dev.vars.example` → `.dev.vars` and `npm run dev`.

## Durable Objects (optional)

The play counter uses a **D1 atomic UPDATE** by default (works on the free plan).
For strict serialization under heavy concurrency, switch to a Durable Object:
uncomment the DO blocks in `wrangler.toml` and the `PlayCounter` path in
`src/lib/counter.ts`. **DO requires the Workers Paid plan ($5/mo).**
