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

// When metering is enabled (VITE_API_BASE_URL set at build time) the static
// CSP would silently block every metering fetch and the Turnstile widget —
// the client fails open, so the paywall would just never work. Widen the
// policy at build time instead of asking the deployer to hand-edit
// index.html:
//   connect-src  'self' + the API origin + the Turnstile host
//   script-src / frame-src  + challenges.cloudflare.com (the widget)
// With VITE_API_BASE_URL unset (the default deploy) the emitted CSP is
// byte-identical to the one checked into index.html.
function meteringCsp(apiBaseUrl: string): Plugin {
  return {
    name: 'metering-csp',
    apply: 'build',
    transformIndexHtml(html) {
      if (!apiBaseUrl) return html;
      const apiOrigin = new URL(apiBaseUrl).origin;
      const turnstile = 'https://challenges.cloudflare.com';
      // Fail the build, not the paywall: if a CSP edit in index.html breaks
      // either anchor substring, a silent no-op here would ship a policy that
      // blocks every metering fetch — and the fail-open client would simply
      // never show the paywall. A thrown error surfaces it at build time.
      const widenScript = html.replace("script-src 'self';", `script-src 'self' ${turnstile};`);
      if (widenScript === html) {
        throw new Error("meteringCsp: script-src anchor not found in index.html CSP");
      }
      const widened = widenScript.replace(
        "font-src 'self';",
        `font-src 'self'; connect-src 'self' ${apiOrigin} ${turnstile}; frame-src ${turnstile};`,
      );
      if (widened === widenScript) {
        throw new Error("meteringCsp: font-src anchor not found in index.html CSP");
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
    plugins: [stripCspMetaInDev(), meteringCsp(env.VITE_API_BASE_URL ?? '')],
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
