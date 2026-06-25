import { clamp } from '../utils/clamp.ts';

// Act III — "The Fermi Paradox". The dark-forest loop, mechanized: a system that
// broadcasts loudly enough is found by something hidden in the dark and struck.
// Survival is staying quiet. This module is the pure model — no rendering, no DOM,
// no physics — so it is fully unit-testable, mirroring world.ts's shape.
//
// "Broadcast" (a 0..1 visibility) rises with three observable signals:
//   • luminosity — the total mass of the system's stars (bright stars carry far),
//   • life       — Σ(population × dawns) over its worlds (a persistent, advanced
//                  civilization announces itself), and
//   • flare      — a brief, decaying spike each time a star detonates (a supernova
//                  is a loud flash the whole forest can see).
// Stay below the detection threshold and the forest never notices. Cross it and a
// hunter begins to lock on; stay loud and the strike lands.
//
// Constants are game-feel-tuned (mixed pixel/mass units), not SI — tune by playing.
export const VISIBILITY = {
  lumRef: 32, // luminosity (Σ star mass) that reads as "fully bright"
  lifeRef: 20, // Σ(population × dawns) that reads as "fully broadcasting"
  lumWeight: 0.5,
  lifeWeight: 0.4,
  flareWeight: 0.6, // a supernova alone can briefly push you over the threshold
  smoothing: 1.5, // EMA rate (per second) the displayed visibility eases at
  flareDecay: 0.7, // a flare fades toward 0 over a few seconds
  detectThreshold: 0.45, // broadcast above this starts the forest noticing
  detectDecay: 2, // detection cools this many ×dt per second while quiet
  lockSeconds: 4, // sustained loud time before a hunter locks on
  strikeSeconds: 5, // grace after a lock before the strike lands — go quiet!
  unlockBelow: 0.3, // drop visibility below this (after a lock) to break the lock
  surviveSeconds: 25, // sustained quiet, once the forest has woken → you survive
} as const;

// A civilization hidden in the dark at the edge of the field. `stir` (0..1) is how
// awake it is — it eases toward the player's visibility, telegraphing the danger;
// the one that locks on becomes the `hunter` and stirs all the way up.
export interface HiddenSystem {
  x: number;
  y: number;
  stir: number;
  hunter: boolean;
}

export interface BroadcastSignals {
  luminosity: number; // Σ star mass
  life: number; // Σ(population × dawns) over the worlds
  center: { x: number; y: number }; // the player system's barycenter (to pick the nearest hunter)
}

// One event per frame, in priority order: a strike ends it; otherwise a fresh
// lock, otherwise survival, otherwise nothing.
export type HuntEvent = null | 'locked' | 'strike' | 'survived';

// Pure broadcast math: blend the three signals, normalized, into a 0..1 visibility.
export function computeBroadcast(luminosity: number, life: number, flare: number): number {
  const lum = luminosity / VISIBILITY.lumRef;
  const lif = life / VISIBILITY.lifeRef;
  const raw =
    VISIBILITY.lumWeight * lum + VISIBILITY.lifeWeight * lif + VISIBILITY.flareWeight * flare;
  return clamp(raw, 0, 1);
}

export class DarkForest {
  readonly systems: HiddenSystem[];
  visibility = 0; // smoothed broadcast, 0..1 — what the meter shows
  detection = 0; // seconds of accumulated "the forest is noticing"
  locked = false; // a hunter has locked on
  lockTimer = 0; // seconds since the lock — counts toward the strike
  provoked = false; // the forest has woken at least once (gates the survival win)
  silentTimer = 0; // seconds of sustained quiet since waking
  private flareLevel = 0; // decaying supernova flash, 0..1
  private done = false; // latched once a strike or survival has fired

  constructor(systems: HiddenSystem[]) {
    this.systems = systems;
  }

  // A star just detonated — a bright flash the forest can see. Spikes the flare,
  // which decays over the next few seconds.
  flash(): void {
    this.flareLevel = 1;
  }

  // Advance the hunt one frame. Returns the event that fired this frame (if any).
  update(dt: number, signals: BroadcastSignals): HuntEvent {
    if (this.done) return null;

    // Flare decays continuously; broadcast eases toward its instantaneous value.
    this.flareLevel = Math.max(0, this.flareLevel - VISIBILITY.flareDecay * dt);
    const target = computeBroadcast(signals.luminosity, signals.life, this.flareLevel);
    this.visibility += (target - this.visibility) * Math.min(1, VISIBILITY.smoothing * dt);

    const loud = this.visibility > VISIBILITY.detectThreshold;
    if (loud) {
      this.detection += dt;
      this.provoked = true;
      this.silentTimer = 0;
    } else {
      this.detection = Math.max(0, this.detection - VISIBILITY.detectDecay * dt);
      if (this.provoked) this.silentTimer += dt;
    }

    // Systems stir toward the current visibility so the forest visibly "wakes".
    for (const s of this.systems) {
      const aim = s.hunter ? 1 : this.visibility;
      s.stir += (aim - s.stir) * Math.min(1, 2 * dt);
    }

    if (this.locked) {
      // A reprieve: drop quiet enough and the lock breaks before the strike.
      if (this.visibility < VISIBILITY.unlockBelow) {
        this.locked = false;
        this.lockTimer = 0;
        for (const s of this.systems) s.hunter = false;
        return null;
      }
      this.lockTimer += dt;
      if (this.lockTimer >= VISIBILITY.strikeSeconds) {
        this.done = true;
        return 'strike';
      }
      return null;
    }

    // Not locked yet: long enough above the threshold → a hunter locks on.
    if (this.detection >= VISIBILITY.lockSeconds) {
      this.locked = true;
      this.lockTimer = 0;
      this.markNearestHunter(signals.center);
      return 'locked';
    }

    // Woke the forest, then stayed silent long enough → you endured the dark.
    if (this.provoked && this.silentTimer >= VISIBILITY.surviveSeconds) {
      this.done = true;
      return 'survived';
    }
    return null;
  }

  // Flag the hidden system closest to the player's barycenter as the hunter.
  private markNearestHunter(center: { x: number; y: number }): void {
    let best: HiddenSystem | null = null;
    let bestD = Infinity;
    for (const s of this.systems) {
      const d = (s.x - center.x) ** 2 + (s.y - center.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (best) best.hunter = true;
  }
}
