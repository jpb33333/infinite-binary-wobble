/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built bundle works under any GitHub Pages subpath.
  base: './',
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
    reporters: 'default',
  },
});
