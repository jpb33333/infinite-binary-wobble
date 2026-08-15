# Security Policy

Infinite Binary Wobble is a static, client-side browser game deployed to GitHub
Pages. **The deployed game has no backend, no accounts, and collects no personal
data** — it runs entirely in the visitor's browser. Its only network traffic is
the optional music pill: the SoundCloud player widget in a sandboxed iframe
(CSP `frame-src`), plus a single fetch to SoundCloud's oEmbed endpoint when a
player pastes a station link (CSP `connect-src`); both are pinned to SoundCloud
hosts in the policy AND re-validated against a host allowlist in code. (A metering/payments backend exists in this repo under `api-worker/`,
unit-tested but **not deployed**; its client half ships in the bundle but is
inert — it makes zero network calls unless `VITE_API_BASE_URL` was set at
build time, which the default deploy never sets. This document must be updated
before that ships — see `ROADMAP.md` Phase G.) The attack surface is small by design;
this document records how it's kept that way and how to report anything we
missed.

## Reporting a vulnerability

Please **do not** open a public issue for security reports.

Use GitHub's private vulnerability reporting:
**https://github.com/jpb33333/infinite-binary-wobble/security/advisories/new**

Acknowledgement within a few days. No bounty (hobby project) — credit gladly
given. Machine-readable contact: [`/.well-known/security.txt`](./public/.well-known/security.txt).

## What protects the deployed game

- **Strict Content-Security-Policy** — `default-src 'none'` with a least-privilege
  same-origin allowlist (`script`/`style`/`img`/`font`/`manifest` = `'self'`),
  `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`,
  `upgrade-insecure-requests`. The only external entries are the music pill's:
  `frame-src https://w.soundcloud.com` (the widget) and
  `connect-src https://soundcloud.com` (the oEmbed lookup); every other fetch
  target resolves to `'none'`. **Verified in a real headless browser: zero
  violations, zero console errors, game renders.**
- **Sandboxed third-party frame** — the SoundCloud widget iframe carries
  `sandbox="allow-scripts allow-same-origin allow-popups
  allow-popups-to-escape-sandbox"` and `referrerpolicy="no-referrer"`: no
  top-navigation, no downloads, no modals from the embedded player. Station
  URLs (from oEmbed answers or the localStorage directory) are additionally
  re-validated against a SoundCloud host allowlist before they ever reach the
  frame.
- **Trusted Types** (`require-trusted-types-for 'script'`) — neutralises DOM-XSS
  sinks. The codebase contains no `innerHTML`/`eval`-class sinks, so it enforces
  cleanly where the browser supports it.
- **No inline scripts or styles** — the whole policy holds without `'unsafe-inline'`.
- **`referrer: no-referrer`** — no URL leakage to sites opened from the game.
- **Self-hosted fonts** — no third-party CDN request, no IP/User-Agent leak.
- **No production source maps** — the TypeScript source isn't shipped with the build.
- **Clickjacking** — blocked by a JS frame-buster in `src/main.ts` (the header-only
  `frame-ancestors` can't be delivered on Pages — see below).

## Supply chain & CI

- GitHub Actions pinned to full commit SHAs (no floating tags).
- `npm ci` against a committed lockfile; an **`npm audit --audit-level=high` gate**
  fails the deploy on a high/critical advisory before anything ships.
- **Dependabot** updates npm packages *and* the pinned action SHAs weekly.
- Deploy workflow runs with minimal permissions and `persist-credentials: false`.

## Known limitation — GitHub Pages can't set most HTTP headers

Pages serves the `<meta>` CSP and already sends `Strict-Transport-Security`
(~1 year) and `Access-Control-Allow-Origin: *`. It does **not** send
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy`, or a CSP *header* (so `frame-ancestors` is unavailable).

To close that gap, put **Cloudflare** (free) in front of the Pages site — or move
to Cloudflare Pages / Netlify — and serve these response headers:

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; manifest-src 'self'; frame-src https://w.soundcloud.com; connect-src https://soundcloud.com; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests; require-trusted-types-for 'script'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

> The `frame-src`/`connect-src` SoundCloud entries mirror the meta CSP —
> browsers enforce the *intersection* of header and meta policies, so a header
> without them would silently kill the music pill.

> **Metering caveat.** A `VITE_API_BASE_URL` build widens the meta CSP with
> `connect-src`/`frame-src`/`script-src` entries for the API origin and
> `challenges.cloudflare.com` (see `meteringCsp` in `vite.config.ts`). Browsers
> enforce the *intersection* of header and meta policies — so if web metering
> is enabled, the header above must gain the same entries or it re-blocks
> every metering call and the Turnstile widget.

## Repository settings (enabled)

- **Branch protection on `main`** — PRs only, required `web` + `api-worker`
  checks, enforced for admins, no force pushes or deletions.
- **Dependabot alerts + automated security fixes** — advisory-driven PRs land
  between the weekly version-update runs.
- **Secret scanning + push protection** — enabled.
- **Private vulnerability reporting** — enabled; the reporting link above is
  active.
