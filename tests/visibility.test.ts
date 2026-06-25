import { describe, test, expect } from 'vitest';
import {
  computeBroadcast,
  DarkForest,
  VISIBILITY,
  type BroadcastSignals,
  type HuntEvent,
  type HiddenSystem,
} from '../src/game/visibility.ts';

// Act III's dark-forest loop: broadcast loudly → a hunter locks on → it strikes,
// unless you go quiet in time. The model is pure, so we drive it with fixed steps.

const CENTER = { x: 0, y: 0 };
function systems(): HiddenSystem[] {
  return [
    { x: 1000, y: 0, stir: 0, hunter: false },
    { x: 0, y: 1000, stir: 0, hunter: false },
    { x: -800, y: -600, stir: 0, hunter: false },
  ];
}
function sig(luminosity: number, life = 0): BroadcastSignals {
  return { luminosity, life, center: CENTER };
}
// Step the forest for `seconds` and return every non-null event that fired.
function run(forest: DarkForest, seconds: number, signals: BroadcastSignals, dt = 1 / 60): HuntEvent[] {
  const events: HuntEvent[] = [];
  for (let t = 0; t < seconds; t += dt) {
    const e = forest.update(dt, signals);
    if (e) events.push(e);
  }
  return events;
}

describe('computeBroadcast (pure)', () => {
  test('zero signals → zero broadcast', () => {
    expect(computeBroadcast(0, 0, 0)).toBe(0);
  });

  test('rises monotonically with each signal, and clamps to 1', () => {
    expect(computeBroadcast(32, 0, 0)).toBeGreaterThan(computeBroadcast(8, 0, 0));
    expect(computeBroadcast(0, 20, 0)).toBeGreaterThan(computeBroadcast(0, 5, 0));
    expect(computeBroadcast(0, 0, 1)).toBeGreaterThan(computeBroadcast(0, 0, 0.2));
    expect(computeBroadcast(1000, 1000, 1)).toBe(1);
  });

  test('a bright system alone clears the detection threshold', () => {
    expect(computeBroadcast(VISIBILITY.lumRef, 0, 0)).toBeGreaterThan(VISIBILITY.detectThreshold);
  });
});

describe('DarkForest hunt', () => {
  test('a quiet system is never noticed — no lock, no strike', () => {
    const f = new DarkForest(systems());
    const events = run(f, 30, sig(6)); // dim binary, no life
    expect(events).toEqual([]);
    expect(f.locked).toBe(false);
    expect(f.visibility).toBeLessThan(VISIBILITY.detectThreshold);
  });

  test('a loud system gets locked, then struck if it stays loud', () => {
    const f = new DarkForest(systems());
    const events = run(f, 40, sig(64, 20)); // very bright + broadcasting
    expect(events).toContain('locked');
    expect(events).toContain('strike');
    // The lock must come before the strike.
    expect(events.indexOf('locked')).toBeLessThan(events.indexOf('strike'));
    // Exactly one hidden system — the nearest — becomes the hunter.
    expect(f.systems.filter(s => s.hunter).length).toBe(1);
    expect(f.systems.find(s => s.hunter)).toBe(f.systems[0]); // (1000,0) is nearest to origin
  });

  test('going quiet after a lock breaks it — a reprieve, no strike', () => {
    const f = new DarkForest(systems());
    // Get loud enough to lock…
    let events: HuntEvent[] = [];
    for (let t = 0; t < 40 && !f.locked; t += 1 / 60) {
      const e = f.update(1 / 60, sig(64, 20));
      if (e) events.push(e);
    }
    expect(f.locked).toBe(true);
    // …then fall silent. The lock should break well before the 5s strike grace.
    events = events.concat(run(f, 3, sig(4)));
    expect(events).not.toContain('strike');
    expect(f.locked).toBe(false);
    expect(f.systems.some(s => s.hunter)).toBe(false);
  });

  test('waking the forest then staying silent long enough → survival', () => {
    const f = new DarkForest(systems());
    // A brief loud spell — enough to provoke, not enough to lock…
    const events = run(f, 2, sig(64, 20));
    expect(events).not.toContain('locked');
    expect(f.provoked).toBe(true);
    // …then quiet for longer than the survival window.
    const tail = run(f, VISIBILITY.surviveSeconds + 3, sig(4));
    expect(tail).toContain('survived');
  });

  test('a supernova flash briefly spikes visibility on an otherwise quiet system', () => {
    const f = new DarkForest(systems());
    run(f, 1, sig(4)); // settle quiet
    const before = f.visibility;
    f.flash();
    run(f, 0.3, sig(4)); // a few frames after the flash
    expect(f.visibility).toBeGreaterThan(before);
    // The flare decays — visibility falls back below the threshold afterwards.
    run(f, 4, sig(4));
    expect(f.visibility).toBeLessThan(VISIBILITY.detectThreshold);
  });

  test('once a strike has fired, the model latches (no further events)', () => {
    const f = new DarkForest(systems());
    run(f, 40, sig(64, 20)); // run to a strike
    expect(f.update(1 / 60, sig(64, 20))).toBe(null);
  });
});
