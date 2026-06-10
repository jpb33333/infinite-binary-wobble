# Security Policy

Infinite Binary Wobble is a static, client-side browser game deployed to GitHub
Pages. It has **no backend, no accounts, and collects no personal data** — the
game runs entirely in the visitor's browser and makes zero network requests. The
attack surface is small by design; this document records how it's kept that way
and how to report anything we missed.

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
  `upgrade-insecure-requests`. The game makes no network calls, so `connect-src`
  resolves to `'none'`. **Verified in a real headless browser: zero violations,
  zero console errors, game renders.**
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
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests; require-trusted-types-for 'script'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

## Recommended repository settings

- **Dependabot alerts** — free for private repos; enable in Settings → Security.
- **Secret scanning + push protection** — enable if available on your plan.
- **Private vulnerability reporting** — enable in Settings → Security so the
  reporting link above is active.
