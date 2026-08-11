import { describe, test, expect } from 'vitest';
import { unlock, playPing, playStrike, playGraze } from '../src/audio/sfx.ts';

// The SFX module's unit-testable surface is its fail-open contract: in an
// environment with no AudioContext (Node/vitest — and any browser where audio
// is unavailable or blocked), every call is a safe no-op. The audible behavior
// itself is verified by ear in a real browser (see the repo rule on
// play-through verification).
describe('sfx — fail-open without an AudioContext', () => {
  test('unlock is a no-op that never throws', () => {
    expect(() => unlock()).not.toThrow();
    expect(() => unlock()).not.toThrow(); // idempotent
  });

  test('playPing never throws, at any strength, unlocked or not', () => {
    expect(() => playPing(0)).not.toThrow();
    expect(() => playPing(0.5)).not.toThrow();
    expect(() => playPing(1)).not.toThrow();
    expect(() => playPing(Number.NaN)).not.toThrow();
    unlock();
    expect(() => playPing(0.7)).not.toThrow();
  });

  test('playStrike never throws', () => {
    expect(() => playStrike()).not.toThrow();
    unlock();
    expect(() => playStrike()).not.toThrow();
  });

  test('playGraze never throws', () => {
    expect(() => playGraze()).not.toThrow();
    unlock();
    expect(() => playGraze()).not.toThrow();
  });
});
