import { describe, test, expect } from 'vitest';
import {
  computeBroadcast,
  systemBroadcast,
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
    { x: 900, y: 0, hx: 900, hy: 0, stir: 0, hunter: false },
    { x: 0, y: 1000, hx: 0, hy: 1000, stir: 0, hunter: false },
    { x: -800, y: -600, hx: -800, hy: -600, stir: 0, hunter: false },
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

describe('systemBroadcast (pure signal derivation)', () => {
  test('luminosity sums star masses; life sums population × dawns', () => {
    const { luminosity, life } = systemBroadcast(
      [3, 5, 2],
      [
        { population: 4, dawns: 2 },
        { population: 1, dawns: 3 },
      ],
    );
    expect(luminosity).toBe(10);
    expect(life).toBe(11); // 4*2 + 1*3
  });

  test('an empty system broadcasts nothing', () => {
    expect(systemBroadcast([], [])).toEqual({ luminosity: 0, life: 0 });
  });

  test('a young world (dawns 0) contributes no life yet', () => {
    expect(systemBroadcast([4], [{ population: 8, dawns: 0 }]).life).toBe(0);
  });
});

describe('DarkForest progress ratios (meter legibility)', () => {
  test('detectionProgress builds while loud; strikeProgress is 0 until a lock', () => {
    const f = new DarkForest(systems());
    // Loud, but stop short of the lock: detection is partway, no strike yet.
    run(f, VISIBILITY.lockSeconds * 0.5, sig(64, 20));
    expect(f.locked).toBe(false);
    expect(f.detectionProgress).toBeGreaterThan(0);
    expect(f.detectionProgress).toBeLessThan(1);
    expect(f.strikeProgress).toBe(0);
  });

  test('once locked, strikeProgress advances and surviveProgress stays 0', () => {
    const f = new DarkForest(systems());
    for (let t = 0; t < 40 && !f.locked; t += 1 / 60) f.update(1 / 60, sig(64, 20));
    expect(f.locked).toBe(true);
    f.update(1 / 60, sig(64, 20));
    expect(f.strikeProgress).toBeGreaterThan(0);
    expect(f.surviveProgress).toBe(0); // locked → not surviving
  });

  test('surviveProgress advances only once provoked and gone quiet', () => {
    const f = new DarkForest(systems());
    expect(f.surviveProgress).toBe(0); // never provoked
    run(f, 2, sig(64, 20)); // provoke without locking
    expect(f.provoked).toBe(true);
    run(f, 5, sig(4)); // fall quiet
    expect(f.surviveProgress).toBeGreaterThan(0);
    expect(f.surviveProgress).toBeLessThan(1);
  });
});

describe('DarkForest running dark (the survival lever)', () => {
  test('going dark damps the broadcast and breaks a lock — without changing the signals', () => {
    const f = new DarkForest(systems());
    for (let t = 0; t < 40 && !f.locked; t += 1 / 60) f.update(1 / 60, sig(64, 20));
    expect(f.locked).toBe(true);
    // Identical loud signals, but now quiet=true (running dark): visibility
    // collapses below the unlock floor and the lock breaks — the reprieve.
    let broke = false;
    for (let t = 0; t < 6; t += 1 / 60) {
      f.update(1 / 60, sig(64, 20), true);
      if (!f.locked) {
        broke = true;
        break;
      }
    }
    expect(broke).toBe(true);
    expect(f.visibility).toBeLessThan(VISIBILITY.unlockBelow);
  });

  test('a brief loud spell then running dark reaches survival, even while loud', () => {
    const f = new DarkForest(systems());
    let survived = false;
    for (let t = 0; t < VISIBILITY.surviveSeconds + 8; t += 1 / 60) {
      const loud = t < 1.5; // wake the forest, then run dark through the window
      const ev = f.update(1 / 60, sig(64, 20), !loud);
      if (ev === 'survived') {
        survived = true;
        break;
      }
    }
    expect(survived).toBe(true);
  });
});

// The broadcast-ping layer draws these two quantities (see pings.test.ts):
// lastEmission is the INSTANTANEOUS signal fed to the forest this frame — the
// thing GO DARK cuts immediately — while `visibility` stays the slow EMA the
// meter shows. Exposing them is what lets the renderer teach the difference.
describe('emission + flare exposure for the ping layer', () => {
  test('running dark cuts the emission to the damp floor at once', () => {
    const f = new DarkForest(systems());
    // Two loud seconds: the smoothed visibility climbs well above the floor.
    for (let t = 0; t < 2; t += 1 / 60) f.update(1 / 60, sig(64, 20), false);
    const loudEmission = f.lastEmission;
    expect(loudEmission).toBeGreaterThan(VISIBILITY.detectThreshold);
    f.update(1 / 60, sig(64, 20), true);
    expect(f.lastEmission).toBeCloseTo(loudEmission * VISIBILITY.darkDamp, 5);
    // ...while the smoothed visibility is still easing down, far above the
    // emission — the exact gap the ping layer exists to explain.
    expect(f.visibility).toBeGreaterThan(f.lastEmission);
  });

  test('the flare getter spikes on flash and decays through update', () => {
    const f = new DarkForest(systems());
    expect(f.flare).toBe(0);
    f.flash();
    expect(f.flare).toBe(1);
    f.update(0.5, sig(0, 0), false);
    expect(f.flare).toBeCloseTo(1 - VISIBILITY.flareDecay * 0.5, 5);
  });
});

// ── Stakes: the forest remembers, shots graze, the ring closes ──
describe('wariness — every broken lock sharpens the forest', () => {
  const breakLock = (f: DarkForest): void => {
    // Get locked (loud past the effective lock window), then go dark to break it early.
    let guard = 0;
    while (!f.locked && guard++ < 60 * 30) f.update(1 / 60, sig(64, 20), false);
    expect(f.locked).toBe(true);
    guard = 0;
    while (f.locked && guard++ < 60 * 30) f.update(1 / 60, sig(64, 20), true);
    expect(f.locked).toBe(false);
  };

  test('escalation getters equal the base constants before any escape', () => {
    const f = new DarkForest(systems());
    expect(f.effectiveThreshold).toBeCloseTo(VISIBILITY.detectThreshold, 10);
    expect(f.effectiveLockSeconds).toBeCloseTo(VISIBILITY.lockSeconds, 10);
    expect(f.effectiveStrikeSeconds).toBeCloseTo(VISIBILITY.strikeSeconds, 10);
  });

  test('each broken lock lowers the threshold and shortens both windows, to floors', () => {
    const f = new DarkForest(systems());
    let prevT = f.effectiveThreshold;
    let prevL = f.effectiveLockSeconds;
    let prevS = f.effectiveStrikeSeconds;
    for (let i = 0; i < 3; i++) {
      breakLock(f);
      expect(f.locksBroken).toBe(i + 1);
      expect(f.effectiveThreshold).toBeLessThanOrEqual(prevT);
      expect(f.effectiveLockSeconds).toBeLessThanOrEqual(prevL);
      expect(f.effectiveStrikeSeconds).toBeLessThanOrEqual(prevS);
      prevT = f.effectiveThreshold;
      prevL = f.effectiveLockSeconds;
      prevS = f.effectiveStrikeSeconds;
    }
    // Floors hold no matter how many escapes.
    for (let i = 0; i < 12; i++) f.locksBroken++;
    expect(f.effectiveThreshold).toBeGreaterThanOrEqual(VISIBILITY.waryThresholdFloor);
    expect(f.effectiveThreshold).toBeGreaterThan(VISIBILITY.unlockBelow);
    expect(f.effectiveLockSeconds).toBeGreaterThanOrEqual(VISIBILITY.waryLockFloor);
    expect(f.effectiveStrikeSeconds).toBeGreaterThanOrEqual(VISIBILITY.waryStrikeFloor);
  });

  test('a warier forest locks on measurably faster', () => {
    const timeToLock = (f: DarkForest): number => {
      let t = 0;
      while (!f.locked && t < 60) {
        f.update(1 / 60, sig(64, 20), false);
        t += 1 / 60;
      }
      return t;
    };
    const fresh = new DarkForest(systems());
    const wary = new DarkForest(systems());
    wary.locksBroken = 2;
    expect(timeToLock(wary)).toBeLessThan(timeToLock(fresh));
  });
});

describe('grazes — a late escape still costs', () => {
  const lockUp = (f: DarkForest): void => {
    let guard = 0;
    while (!f.locked && guard++ < 60 * 30) f.update(1 / 60, sig(64, 20), false);
    expect(f.locked).toBe(true);
  };

  test('escaping early in the strike window is a clean break — null, no graze', () => {
    const f = new DarkForest(systems());
    lockUp(f);
    // Go dark immediately: lockTimer is still tiny.
    let ev: HuntEvent = null;
    let guard = 0;
    while (f.locked && guard++ < 60 * 30) ev = f.update(1 / 60, sig(64, 20), true);
    expect(ev).toBeNull();
    expect(f.locksBroken).toBe(1);
  });

  test('escaping past the graze fraction returns exactly one graze', () => {
    const f = new DarkForest(systems());
    lockUp(f);
    // Ride the lock deep into the window, then break it.
    const deep = f.effectiveStrikeSeconds * (VISIBILITY.grazeAfter + 0.15);
    let t = 0;
    while (t < deep && f.locked) {
      f.update(1 / 60, sig(64, 20), false);
      t += 1 / 60;
    }
    expect(f.locked).toBe(true);
    const events: HuntEvent[] = [];
    let guard = 0;
    while (f.locked && guard++ < 60 * 30) events.push(f.update(1 / 60, sig(64, 20), true));
    expect(events.filter(e => e === 'graze').length).toBe(1);
    expect(events).not.toContain('strike');
    expect(f.locksBroken).toBe(1);
    // The hunt goes on — no latch after a graze (a quiet frame passes
    // eventlessly; a LOUD one would legitimately re-lock the warier forest).
    expect(f.update(1 / 60, sig(0, 0), true)).toBeNull();
  });
});

describe('the ring closes in — and remembers', () => {
  const dist = (s: HiddenSystem): number => Math.hypot(s.x - CENTER.x, s.y - CENTER.y);

  test('a loud, provoked forest drifts inward from home', () => {
    const f = new DarkForest(systems());
    const before = f.systems.map(dist);
    for (let t = 0; t < 10; t += 1 / 60) f.update(1 / 60, sig(64, 20), false);
    f.systems.forEach((s, i) => expect(dist(s)).toBeLessThan(before[i]));
  });

  test('falling quiet retreats only partway once locks have been broken', () => {
    const f = new DarkForest(systems());
    f.locksBroken = 2;
    // Stir them up while staying under the wary threshold (≈0.36): visibility
    // ~0.35 wakes the ring without ever forming a lock or latching a strike.
    for (let t = 0; t < 12; t += 1 / 60) f.update(1 / 60, sig(22.4, 0), false);
    // Long quiet: stir decays toward 0, but the wariness close-in remains.
    for (let t = 0; t < 40; t += 1 / 60) f.update(1 / 60, sig(0, 0), false);
    const s = f.systems[0];
    const homeD = Math.hypot(s.hx - CENTER.x, s.hy - CENTER.y);
    const kept = 1 - dist(s) / homeD;
    expect(kept).toBeGreaterThan(VISIBILITY.ringClosePerLock * f.locksBroken * 0.8);
    expect(kept).toBeLessThanOrEqual(VISIBILITY.ringCloseMax + 1e-6);
  });
});
