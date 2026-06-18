# Infinite Binary Wobble — Roadmap, Provisioning & Resume Guide

The single place to see **what's done, what's next, and how to pick this up on a
new machine**. The full architecture is in
[`MONETIZATION_PLAN.md`](./MONETIZATION_PLAN.md); this is the actionable version.

_Last updated: 2026-06-10._

## The goal

Turn the (live, free) web game into a **metered, monetized product**: 200 free
plays, then pay to keep playing.

- **iOS:** Apple In-App Purchase, fixed "support the dev" tiers (e.g. $1/$3/$5/$10).
- **Web:** Stripe **pay-what-you-want** (≥ $1).
- **Metering:** iOS via Apple **App Attest** + a server-held count (enforceable,
  no login); **web is best-effort** (a client you can't lock down).
- One **Cloudflare Worker** backend is the trust root for both.

## Status

| | |
|---|---|
| ✅ **Live** | Hardened web game (strict CSP + Trusted Types, portrait + PWA install) — https://jpb33333.github.io/infinite-binary-wobble/ |
| ✅ **On `main`, dark/inert** | `api-worker/` backend (Stripe checkout + verified-webhook persistence, session reuse — unit-tested); web metering client (`src/net/`, refresh-first, `paywall` state) — does nothing until `VITE_API_BASE_URL` is set |
| ✅ **Shipped (in-repo)** | Native iOS app core (`ios/`, SwiftUI Canvas, golden-parity physics, bundled fonts) — Phase D done; the standalone iOS repo is archived |
| ⛔ **Blocked on provisioning** | Deploying the backend; enabling web metering; the Cloudflare edge headers |
| 📋 **Not started** | iOS commerce layer (StoreKit 2 + App Attest, Phases E/F); privacy policy + App Privacy label update |

**Backend — real vs stubbed** (`api-worker/`): real + unit-tested — router, CORS
lock, signed web token (device reuse + sliding renewal), gate logic, D1 counter,
Turnstile session, **Stripe webhook signature verification**, **Stripe Checkout
creation + verified-webhook entitlement persistence** (idempotent unlock /
refund-relock). Stubbed (need secrets/SDKs) — App Attest, StoreKit 2 + App
Store Server API/Notifications.

## Sequenced work

> Phases A–C bring the **web** metering live (~1–2 weeks once provisioned).
> D–H are the **iOS** track (multi-week). Do them in order.

### Phase 0 — Provisioning ⟵ YOU; blocks everything
See the checklist below. Nothing past here can be wired or tested until it's done.

### Phase A — Cloudflare edge headers (~0.5 d)
Front the Pages site with Cloudflare and add the real HTTP security headers (HSTS,
a CSP *header* with `frame-ancestors`, `nosniff`, `X-Frame-Options`, …) that Pages
can't set. Mechanism: a CNAME + a Response Header Transform Rule. (Exact header set
in `SECURITY.md`.)

### Phase B — Deploy + wire the backend (~1–2 d)
`cd api-worker`, follow its `README.md`: create D1 + KV, set secrets, deploy the
Worker. Point the Stripe webhook + Apple notifications at it.

### Phase C — Enable web metering end-to-end (~1–2 d)
Set `VITE_API_BASE_URL` + `VITE_TURNSTILE_SITE_KEY` for the web build — the build
widens the CSP automatically (`meteringCsp` in `vite.config.ts`), and the backend
pieces (Stripe Checkout creation; verified webhook → D1 entitlement) shipped in
0.4.x. **The game and the API must share a registrable domain**: the device cookie
is `SameSite=Strict`, so the `github.io` + `workers.dev` combination silently
no-ops (fail-open — see "Cookie & origin constraint" in `api-worker/README.md`).
Test: play to the limit → paywall → Stripe checkout → unlock → **reload** (the
entitlement must survive the `?checkout=success` redirect).

### Phase D — iOS native core ✅ DONE (shipped in-repo, 0.4.x)
The rewrite specced in `IOS_NATIVE_APP_PLAN.md` shipped under `ios/` (PR #24;
fonts + constants guard harvested in PR #27). What remains of the iOS track is
commerce (E/F) and the App Store submission (H).

### Phase E/F — iOS commerce + backend iOS endpoints (~2–3 wk)
App Attest + StoreKit 2 in the app; App Attest verification + StoreKit / App Store
Server API + Notifications V2 in the Worker. **Implement + verify against Apple's
sandbox + test vectors — do not ship these unverified** (a bug bricks users or
opens the gate).

### Phase G — Privacy / compliance
App Privacy label (now collects Purchases + Identifiers + Usage), a **published
privacy policy** (required once data is collected), and correcting the "no backend
/ collects no data" claims in `SECURITY.md` / `README.md` when metering ships.

### Phase H — Submit
TestFlight + App Review (give reviewers a way to reach the paywall) + the web launch.

## Provisioning checklist (only you can do these)

1. **Cloudflare account.** Free is fine (the counter uses a free D1 path).
   Durable Objects (optional, stronger counter) need the **$5/mo Workers Paid** plan.
2. **A custom domain** added to Cloudflare (for the API + to front the site).
3. **Stripe account** → API **secret key**; create a **webhook endpoint** → its
   **signing secret**.
4. **Cloudflare Turnstile** → a **site key** (public) + **secret key**.
5. **Apple** (iOS track): App Store Connect **In-App Purchase key** (.p8 + key id +
   issuer id); enable **App Attest** for the app id.
6. **Load the Worker secrets** (never in the repo), each via `wrangler secret put`:
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TURNSTILE_SECRET`,
   `TOKEN_SIGNING_KEY` (`openssl rand -base64 32`), `APPLE_IAP_KEY`, `APPLE_KEY_ID`,
   `APPLE_ISSUER_ID`.
7. **Web build env:** `VITE_API_BASE_URL` (your Worker origin) + `VITE_TURNSTILE_SITE_KEY`.

Costs: Apple ~15% (Small Business Program) on IAP; Stripe ~2.9% + 30¢; Cloudflare
free tier covers hobby scale (or $5/mo for Durable Objects).

## Resume on a NEW laptop / new terminal

```sh
# 1. Tools: install Git, the GitHub CLI (gh), and Node 22 (nvm or Homebrew).
gh auth login

# 2. Git identity — IMPORTANT, so the new machine doesn't bake its hostname into
#    your commit emails (the old machine did). Use your GitHub no-reply address:
git config --global user.name  "jpb33333"
git config --global user.email "205030017+jpb33333@users.noreply.github.com"

# 3. Get the game running
gh repo clone jpb33333/infinite-binary-wobble
cd infinite-binary-wobble
npm install
npm run dev      # http://localhost:5173
npm test         # 43 tests

# 4. When you're ready to deploy the backend
cd api-worker
npm install
npm run typecheck && npm test
#   then follow api-worker/README.md: wrangler login, create D1/KV, set secrets, deploy
```

Then read [`MONETIZATION_PLAN.md`](./MONETIZATION_PLAN.md) for the full
architecture, and **Sequenced work** above for the order.

## Open maintenance — Dependabot

Dependabot (`.github/dependabot.yml`) watches root npm, `/api-worker` npm, and
the pinned GitHub Actions, weekly. The 2026-06-04 batch (five Action bumps + the
dev-deps group) was reviewed and merged 2026-06-10. Future PRs are gated by
`ci.yml` automatically; the standing advice holds — Action bumps are CI-only and
low risk, dev-dependency bumps deserve a local build-test before merging.

## Pull requests that built this

- #10 — security hardening (merged, live)
- #17 — Cloudflare Worker backend scaffold + Stripe signature verification (merged)
- #18 — web metering client (merged, dark)
- #9 — accounts/auth architecture plan (merged)
- #24 — native iOS app + portrait mode + PWA install + softened-energy fix (0.4.0)
- #25 — hygiene: manifest-src CSP fix, fixture-parity guardrails (merged, live)
- #26 — metering integrity: session reuse, webhook retry safety, PR CI gate (merged)
- #27 — iOS asset harvest + the 200-free-plays & Bowditch Gaming decisions (merged)
