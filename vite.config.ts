/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';

// Vite's dev server spawns blob:-URL workers for client transforms which the
// production CSP (script-src 'self') blocks, polluting the dev console with
// errors that aren't real. Strip the meta CSP in dev only — the same tag is
// emitted untouched in build, so the production bundle keeps the tight policy.
function stripCspMetaInDev(): Plugin {
  return {
    name: 'strip-csp-meta-in-dev',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(
        /<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>\s*/i,
        '',
      );
    },
  };
}

// When metering (VITE_API_BASE_URL) or analytics (VITE_GA_MEASUREMENT_ID) is
// enabled at build time, the static CSP (script-src 'self', no connect-src)
// would silently block the thing it just turned on — every metering fetch + the
// Turnstile widget, or the GA script + its data beacons. The clients all fail
// open, so the feature would just never work. Widen the policy at build time in
// ONE pass (two plugins both rewriting the script-src anchor would collide) —
// instead of asking the deployer to hand-edit index.html:
//   metering  → script-src + Turnstile; connect-src 'self' + API + Turnstile; frame-src Turnstile
//   analytics → script-src + googletagmanager; connect-src + *.google-analytics.com + *.googletagmanager.com
// With neither var set (the default deploy) the emitted CSP is byte-identical to
// the one checked into index.html.
function widenCsp(apiBaseUrl: string, gaId: string): Plugin {
  return {
    name: 'widen-csp',
    apply: 'build',
    transformIndexHtml(html) {
      const scriptAdd: string[] = [];
      const connectAdd: string[] = [];
      const frameAdd: string[] = [];
      if (apiBaseUrl) {
        const apiOrigin = new URL(apiBaseUrl).origin;
        const turnstile = 'https://challenges.cloudflare.com';
        scriptAdd.push(turnstile);
        connectAdd.push("'self'", apiOrigin, turnstile);
        frameAdd.push(turnstile);
      }
      if (gaId) {
        scriptAdd.push('https://www.googletagmanager.com');
        if (!connectAdd.includes("'self'")) connectAdd.push("'self'");
        connectAdd.push('https://*.google-analytics.com', 'https://*.googletagmanager.com');
      }
      if (scriptAdd.length === 0) return html; // nothing configured → byte-identical
      // Fail the build, not the feature: if a CSP edit in index.html breaks
      // either anchor substring, a silent no-op here would ship a policy that
      // blocks the metering fetch / GA beacon — and the fail-open clients would
      // simply go dark. A thrown error surfaces it at build time.
      const widenScript = html.replace(
        "script-src 'self';",
        `script-src 'self' ${scriptAdd.join(' ')};`,
      );
      if (widenScript === html) {
        throw new Error("widenCsp: script-src anchor not found in index.html CSP");
      }
      const extras = [`connect-src ${connectAdd.join(' ')};`];
      if (frameAdd.length) extras.push(`frame-src ${frameAdd.join(' ')};`);
      const widened = widenScript.replace("font-src 'self';", `font-src 'self'; ${extras.join(' ')}`);
      if (widened === widenScript) {
        throw new Error("widenCsp: font-src anchor not found in index.html CSP");
      }
      return widened;
    },
  };
}

export default defineConfig(({ mode }) => {
  // '.' (not process.cwd()) keeps the config free of @types/node.
  const env = loadEnv(mode, '.', 'VITE_');
  return {
    // Relative base so the built bundle works under any GitHub Pages subpath.
    base: './',
    plugins: [
      stripCspMetaInDev(),
      widenCsp(env.VITE_API_BASE_URL ?? '', env.VITE_GA_MEASUREMENT_ID ?? ''),
    ],
    build: {
      target: 'es2022',
      // Off in prod — source maps were publishing the full TypeScript source to
      // the live site, which made client-side cheating a 5-minute job and exposed
      // internal field names to anyone with DevTools. Flip back if you need to
      // debug a prod crash; consider 'hidden' if you want maps but don't want
      // them referenced from the bundle.
      sourcemap: false,
    },
    test: {
      include: ['tests/**/*.test.ts'],
      reporters: 'default' as const,
    },
  };
});
