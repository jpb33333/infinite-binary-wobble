import { describe, it, expect } from 'vitest';
import { initAnalytics, track } from '../src/net/analytics.ts';

// Analytics is fail-open and inert unless VITE_GA_MEASUREMENT_ID is set at build
// time. This suite runs with no env var and (in the node test env) no DOM — the
// exact "disabled" contract: the module must be import-safe, call-safe, and
// touch nothing. The guards (`!GA_ID` / `!ready`) are what hold that line, so a
// regression that removes one would surface here instead of crashing the game.
describe('analytics (disabled / fail-open)', () => {
  it('track() before init is a silent no-op — no gtag, no DOM access', () => {
    expect(() => track('play_start')).not.toThrow();
    expect(() => track('outcome', { result: 'win', duration: 12 })).not.toThrow();
  });

  it('initAnalytics() with no Measurement ID is inert and never throws', () => {
    expect(() => initAnalytics()).not.toThrow();
    // Inert: it must not have installed a global gtag shim.
    expect((globalThis as { gtag?: unknown }).gtag).toBeUndefined();
  });

  it('track() after a no-op init is still a silent no-op', () => {
    initAnalytics();
    expect(() => track('sandbox_add', { kind: 'star', mode: 'set' })).not.toThrow();
  });
});
