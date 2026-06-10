# Monetization & Native-iOS Architecture Plan

> **Canonical in-repo copy** of the approved plan (2026-06-04), moved here from a
> machine-local working file so it travels with the repo. The actionable,
> sequenced version — with the provisioning checklist and a new-machine
> bootstrap — is in [`ROADMAP.md`](./ROADMAP.md).

---

## Context

Infinite Binary Wobble is **(a)** a security-hardened static web canvas game on
GitHub Pages, and **(b)** a written plan for a native-Swift iOS rewrite
(`IOS_NATIVE_APP_PLAN.md`) that was deliberately **offline — "no account, no
network, Data Not Collected."**

The goal: evolve **both** clients into a networked, metered, monetized product —
**200 free plays, then pay to continue** (iOS via Apple IAP tiers; web via Stripe
pay-what-you-want ≥ $1) — sharing **one Cloudflare backend**, built **as securely
as possible**. This breaks the offline assumption, so the work is: stand up a
Cloudflare *trust-root* backend, add a commerce/attestation layer to each client,
front the web site with Cloudflare for real HTTP security headers, and update the
security + privacy posture.

**Locked decisions:** iOS = Apple IAP fixed tiers (no external links in-app,
Guideline 3.1.1); web = Stripe pay-what-you-want; metering = 200 free plays, iOS
enforced via App Attest + server count (no login), web best-effort; web + iOS both
adopt the model; "as securely as possible" is first-class.

**Non-goals:** no user accounts / Sign in with Apple; no external/Stripe purchase
path inside the iOS app; no true web DRM (web metering is a documented best-effort
nudge).

## Architecture

```
   ┌─────────────┐         ┌─────────────┐
   │  Web client │         │ iOS client  │   native Swift (separate repo)
   │ GitHub Pages│         │ App Attest +│
   │ (hardened)  │         │ StoreKit 2  │
   └──────┬──────┘         └──────┬──────┘
          │ HTTPS (CSP connect-src)│ HTTPS (App Attest assertions)
          ▼                        ▼
   ┌──────────────────────────────────────────────┐
   │      Cloudflare  (THE TRUST ROOT)             │
   │  Worker API · Durable Object (counters)       │
   │  D1 (entitlements/purchases/idempotency) · KV │
   │  Turnstile (web bot-gate) · Rate-limit · WAF  │
   │  Transform Rule: HTTP security headers → Pages│
   └───────┬───────────────────────────┬───────────┘
           │ Stripe (web PWYW)          │ Apple App Store Server API +
           ▼                            ▼  Server Notifications V2 (iOS)
     hosted Checkout              refund/revoke + receipt truth
```

**Trust model:** the Cloudflare Worker + Apple/Stripe are the source of truth for
both play-count and entitlement; iOS proves device identity with App Attest; web
metering is friction-only; payment webhooks/JWS are trusted only after signature
verification.

## Cross-cutting decisions

- **Storage:** a **Durable Object** per device for the play counter + App Attest
  assertion counter (race-free, monotonic — needed for a correct gate); **D1** for
  durable entitlement/purchase records **and webhook idempotency**
  (`processed_events`); **KV** reserved for App Attest challenge nonces
  (iOS phase — no current route uses it). ⚠️ DO
  requires the **Workers Paid plan ($5/mo)**; $0 fallback is a D1 atomic
  `UPDATE … SET n=n+1` counter (the scaffold ships this path by default).
- **"A play"** is counted at the **countdown→simulate edge** (`Game.toSimulate()`)
  — fires exactly once, can't be dodged by quitting early. The paywall **gate** is
  at new-play entry (`Game.toSetup1()`). The win/lose scoreboard (`recordGame()` at
  `toResolved()`) is untouched.
- **Entitlement** = a server-derived view of *current* payment state, re-evaluated
  on every webhook; refund/chargeback ⇒ revoke. **Unlock flips only on a
  server-verified webhook/JWS**, never on a client claim or success_url redirect.

## Domain 1 — Cloudflare backend (the trust root)

One Worker (`api-worker`) with D1 + KV + Turnstile + secrets bindings. API at
`api.<domain>`, site fronted at `play.<domain>`.

**Endpoints (`/v1`, JSON, CORS locked to the web origin):** `POST /attest/register`
(iOS App Attest, once) · `POST /play/increment` (the only gate; iOS assertion /
web token) · `GET /status` · `POST /web/session` (Turnstile → HttpOnly signed
token) · `POST /stripe/checkout` (hosted Checkout, PWYW ≥ $1) · `POST
/stripe/webhook` (verified unlock) · `POST /iap/verify` (StoreKit JWS) · `POST
/apple/notifications` (ASSN V2) · `POST /restore`.

**iOS metering:** verify the App Attest attestation once (cert chain → Apple root,
nonce, app id, `signCount==0`); verify each assertion (signature, strictly-rising
`signCount`, single-use nonce) before mutating the server-held count. The client
never sends the count.

**iOS purchases:** validate StoreKit 2 JWS → confirm via App Store Server API → set
entitlement; consume Server Notifications V2 (revoke on refund).

**Web:** Turnstile → signed HttpOnly token → server counter → hosted Stripe
Checkout → webhook-verified unlock. **Honest limitation:** clearing cookies /
editing JS re-earns free plays; Turnstile (plus a Cloudflare rate-limiting rule
added at provisioning — the Worker itself does not rate-limit) raises the cost
but can't prevent it. iOS is the enforceable paywall; web is a goodwill nudge.

**Security:** secrets in Workers Secrets; raw-body signature verification on both
webhooks; rate-limiting (per-IP + per-attest-key) + WAF + Bot Fight Mode; CORS
echoes only the web origin; idempotency via `processed_events` in D1.

**Edge headers:** front Pages via `play.<domain>` CNAME + a Response Header
Transform Rule that sets HSTS, a CSP *header* (incl. `frame-ancestors 'none'` +
`connect-src https://api.<domain>`), `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, `Permissions-Policy`, COOP/CORP.

## Domain 2 — Web app changes (this repo)

- **CSP:** today `connect-src` resolves to `'none'`. Add `connect-src 'self'
  https://api.<domain> https://challenges.cloudflare.com` to `index.html` and the
  Cloudflare CSP header. Stripe via **hosted-Checkout redirect** keeps Stripe
  off-origin (no `js.stripe.com`/`frame-src`).
- **Game hooks:** increment at `toSimulate()`; gate at `toSetup1()` → `'paywall'`
  state. *(Shipped, dark, in `src/net/` + `src/game/states.ts`.)*
- **Meter + paywall UI:** canvas-drawn (no DOM / inline styles → Trusted Types
  intact).

## Domain 3 — iOS app (native rewrite + commerce)

The 7-phase native plan (`IOS_NATIVE_APP_PLAN.md`, SwiftUI `Canvas`) stands; add a
`Commerce/` module: networking (URLSession, ATS on), App Attest
(`DCAppAttestService`, Keychain key, per-request assertions; graceful
jailbroken/unsupported fallback), StoreKit 2 IAP (non-consumable tiers,
`Transaction.currentEntitlements` + updates listener, Restore button), a `PlayGate`
actor (server is truth; optimistic-local + async-confirm so the loop never
stalls), and an offline policy (fail open within the free allotment, closed at the
cap; payers never blocked). Reinstall mints a new attest key (free count resets —
accepted); StoreKit (Apple ID) restores the paid unlock cross-device.

## Security & privacy

**Payment integrity (P0):** Stripe `Stripe-Signature` raw-body verification (5-min
tolerance) *(done + unit-tested in `api-worker/src/lib/stripe.ts`)*; StoreKit JWS +
App Store Server API; unlock only on verified webhook/JWS; idempotency; refunds
revoke.

**Privacy (this becomes a data-collecting app):** iOS App Privacy label moves from
"Data Not Collected" → **Purchases + Identifiers (App Attest key) + Usage Data**,
Tracking = No. A **published privacy policy URL is required**. Update
`SECURITY.md`/`README` "no backend / collects no data" claims when metering ships.
Data minimization: store only an opaque device-scoped id, the integer count, and
purchase records — no PII/IP-at-rest. Hosted Checkout keeps you out of PCI scope.
Strictly-necessary cookies only ⇒ no consent banner.

## Prerequisites you must provide

Apple Developer Program · Cloudflare account (+$5/mo if using Durable Objects) ·
Stripe account · a custom domain · the API secrets. (See `ROADMAP.md` for the full
checklist + costs.)

## Phasing & rough effort

| Phase | Work | Effort |
|---|---|---|
| A | Cloudflare fronts Pages + Transform-Rule security headers | 0.5 d |
| B | Worker skeleton + D1 schema + secrets + CORS | 1 d |
| C | Web metering + `'paywall'` + Stripe Checkout + webhook + CSP | 3–4 d |
| D | iOS native core (the existing 7-phase plan) | ~3 wk |
| E | iOS commerce — App Attest, StoreKit, gate, paywall | 10–14 d |
| F | Backend iOS endpoints — attest verify, StoreKit/ASSN V2 | ~5 d |
| G | Privacy policy + label; rate-limits; idempotency; abuse tests | 2–3 d |
| H | TestFlight + App Review + web launch | 1–2 d |

Critical path to a **web** launch: A→B→C→G (~1.5–2 wk). Full **iOS** launch adds
D+E+F+H.

## Top risks

1. **App Attest verification correctness** (CBOR / x5c chain / `signCount`) — use
   Apple's test vectors; validate in dev first.
2. **Webhook signature / idempotency gaps** — mandatory raw-body verification +
   dedupe + `livemode`/`environment` checks.
3. **CSP regression** — re-verify the header + `connect-src` change in a real browser.
4. **App Review traps** — reachable paywall, privacy policy, corrected label,
   IAP-only in-app (3.1.1).
5. **Durable Object plan dependency** — decide DO ($5/mo) vs D1-counter ($0) early.
6. **Web bypass over-investment** — web metering is un-winnable; lean on iOS.

## Verification

Edge headers via `curl -I` + a headless-browser zero-CSP-violations check; web
metering + paywall in headless Chrome; Stripe via the Stripe CLI (`stripe trigger
checkout.session.completed`) confirming unlock flips only after the verified
webhook; iOS via XCTest physics invariants + App Attest happy-path + a forged
assertion rejected + StoreKit sandbox purchase/restore.
