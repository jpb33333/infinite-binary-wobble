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
  darkDamp: 0.12, // "running dark" cuts the broadcast to this fraction — enough to fall quiet
  // ── Wariness: the forest remembers every broken lock ──
  waryThresholdFactor: 0.9, // detection threshold shrinks by this per broken lock...
  waryThresholdFloor: 0.32, // ...but never below unlockBelow + a sliver, so escape stays possible
  waryLockFactor: 0.75, // locks form this much faster per broken lock...
  waryLockFloor: 1.5, // ...down to this many seconds
  waryStrikeShave: 1, // the strike window loses this many seconds per broken lock...
  waryStrikeFloor: 2, // ...down to this
  grazeAfter: 0.6, // escaping past this fraction of the strike window still costs a graze
  // ── The ring closes in ──
  ringClosePerLock: 0.18, // fraction of home→centre each broken lock keeps them in by
  ringCloseStir: 0.2, // extra close-in while stirred by your visibility
  ringCloseHunter: 0.15, // the locked hunter leans in furthest
  ringCloseMax: 0.5, // they never come closer than halfway
  ringEase: 0.15, // per-second ease toward the current close-in target
} as const;

// A civilization hidden in the dark at the edge of the field. `stir` (0..1) is how
// awake it is — it eases toward the player's visibility, telegraphing the danger;
// the one that locks on becomes the `hunter` and stirs all the way up. `hx`/`hy`
// are its home seat at the frame edge: the system drifts inward from home as the
// hunt escalates (see the ring close-in in DarkForest.update) and only partway
// back when you fall quiet — the forest remembers.
export interface HiddenSystem {
  x: number;
  y: number;
  hx: number;
  hy: number;
  stir: number;
  hunter: boolean;
}

export interface BroadcastSignals {
  luminosity: number; // Σ star mass
  life: number; // Σ(population × dawns) over the worlds
  center: { x: number; y: number }; // the player system's barycenter (to pick the nearest hunter)
}

// One event per frame, in priority order: a strike ends it; a late escape is a
// graze (the shot was already loosed — it lands reduced); otherwise a fresh
// lock, otherwise survival, otherwise nothing.
export type HuntEvent = null | 'locked' | 'strike' | 'survived' | 'graze';

// Pure broadcast math: blend the three signals, normalized, into a 0..1 visibility.
export function computeBroadcast(luminosity: number, life: number, flare: number): number {
  const lum = luminosity / VISIBILITY.lumRef;
  const lif = life / VISIBILITY.lifeRef;
  const raw =
    VISIBILITY.lumWeight * lum + VISIBILITY.lifeWeight * lif + VISIBILITY.flareWeight * flare;
  return clamp(raw, 0, 1);
}

// Derive the two sustained broadcast signals from the live system: luminosity
// (Σ star mass; the caller excludes planets) and life (Σ population×dawns over
// the worlds). Pure, so the signal derivation is unit-tested — not just the hunt
// that consumes it.
export function systemBroadcast(
  starMasses: number[],
  worlds: { population: number; dawns: number }[],
): { luminosity: number; life: number } {
  const luminosity = starMasses.reduce((sum, m) => sum + m, 0);
  const life = worlds.reduce((sum, w) => sum + w.population * w.dawns, 0);
  return { luminosity, life };
}

export class DarkForest {
  readonly systems: HiddenSystem[];
  visibility = 0; // smoothed broadcast, 0..1 — what the meter shows
  detection = 0; // seconds of accumulated "the forest is noticing"
  locked = false; // a hunter has locked on
  lockTimer = 0; // seconds since the lock — counts toward the strike
  provoked = false; // the forest has woken at least once (gates the survival win)
  silentTimer = 0; // seconds of sustained quiet since waking
  // The instantaneous post-damp signal fed to the forest this frame — what the
  // broadcast pings draw. GO DARK cuts this at once, while `visibility` (the
  // meter) only eases toward it: exposing both is what lets the renderer show
  // the difference.
  lastEmission = 0;
  // Locks the player has broken. The forest remembers: every escape lowers the
  // detection threshold, speeds the next lock, and shortens the strike window
  // (the effective* getters below), and keeps the ring standing closer.
  locksBroken = 0;
  private flareLevel = 0; // decaying supernova flash, 0..1
  private done = false; // latched once a strike or survival has fired

  constructor(systems: HiddenSystem[]) {
    this.systems = systems;
  }

  // Escalation-adjusted hunt parameters. At locksBroken = 0 these equal the
  // base VISIBILITY constants exactly, so a first hunt is unchanged.
  get effectiveThreshold(): number {
    return Math.max(
      VISIBILITY.waryThresholdFloor,
      VISIBILITY.detectThreshold * VISIBILITY.waryThresholdFactor ** this.locksBroken,
    );
  }
  get effectiveLockSeconds(): number {
    return Math.max(
      VISIBILITY.waryLockFloor,
      VISIBILITY.lockSeconds * VISIBILITY.waryLockFactor ** this.locksBroken,
    );
  }
  get effectiveStrikeSeconds(): number {
    return Math.max(
      VISIBILITY.waryStrikeFloor,
      VISIBILITY.strikeSeconds - VISIBILITY.waryStrikeShave * this.locksBroken,
    );
  }

  // A star just detonated — a bright flash the forest can see. Spikes the flare,
  // which decays over the next few seconds.
  flash(): void {
    this.flareLevel = 1;
  }

  // Current flare level for the ping layer — the leak that stays visible even
  // while running dark.
  get flare(): number {
    return this.flareLevel;
  }

  // Progress ratios (0..1) the meter reads to make the hunt legible: how close
  // detection is to a lock, the strike countdown once a hunter has locked on, and
  // how far the survival clock has run since the forest first woke.
  get detectionProgress(): number {
    return clamp(this.detection / this.effectiveLockSeconds, 0, 1);
  }
  get strikeProgress(): number {
    return this.locked ? clamp(this.lockTimer / this.effectiveStrikeSeconds, 0, 1) : 0;
  }
  get surviveProgress(): number {
    return this.provoked && !this.locked
      ? clamp(this.silentTimer / VISIBILITY.surviveSeconds, 0, 1)
      : 0;
  }

  // Advance the hunt one frame. Returns the event that fired this frame (if any).
  update(dt: number, signals: BroadcastSignals, quiet = false): HuntEvent {
    if (this.done) return null;

    // Flare decays continuously; broadcast eases toward its instantaneous value.
    // "Running dark" (quiet) shrouds the system — the target collapses toward the
    // floor, so a loud system can deliberately fall silent and break a lock.
    this.flareLevel = Math.max(0, this.flareLevel - VISIBILITY.flareDecay * dt);
    const broadcast = computeBroadcast(signals.luminosity, signals.life, this.flareLevel);
    const target = quiet ? broadcast * VISIBILITY.darkDamp : broadcast;
    this.lastEmission = target;
    this.visibility += (target - this.visibility) * Math.min(1, VISIBILITY.smoothing * dt);

    // The forest's wariness sharpens its senses: every broken lock lowers the
    // effective threshold, so a repeat offender is noticed sooner.
    const loud = this.visibility > this.effectiveThreshold;
    if (loud) {
      this.detection += dt;
      this.provoked = true;
      this.silentTimer = 0;
    } else {
      this.detection = Math.max(0, this.detection - VISIBILITY.detectDecay * dt);
      if (this.provoked) this.silentTimer += dt;
    }

    // Systems stir toward the current visibility so the forest visibly "wakes",
    // and drift inward from their home seats as the hunt escalates. Falling
    // quiet lets them retreat only PART way: broken locks keep the ring
    // permanently closer — the forest remembers, visibly.
    for (const s of this.systems) {
      const aim = s.hunter ? 1 : this.visibility;
      s.stir += (aim - s.stir) * Math.min(1, 2 * dt);
      const closeFrac = Math.min(
        VISIBILITY.ringCloseMax,
        VISIBILITY.ringClosePerLock * this.locksBroken +
          VISIBILITY.ringCloseStir * s.stir +
          (s.hunter ? VISIBILITY.ringCloseHunter : 0),
      );
      const aimX = s.hx + (signals.center.x - s.hx) * closeFrac;
      const aimY = s.hy + (signals.center.y - s.hy) * closeFrac;
      const k = Math.min(1, VISIBILITY.ringEase * dt);
      s.x += (aimX - s.x) * k;
      s.y += (aimY - s.y) * k;
    }

    if (this.locked) {
      // A reprieve: drop quiet enough and the lock breaks before the strike —
      // but escape too late and the shot was already loosed: it lands reduced
      // (a graze). Either way the forest remembers the escape.
      if (this.visibility < VISIBILITY.unlockBelow) {
        const grazed = this.lockTimer / this.effectiveStrikeSeconds > VISIBILITY.grazeAfter;
        this.locked = false;
        this.lockTimer = 0;
        this.locksBroken++;
        // The forest lost its fix: accumulated detection resets, so an escape
        // is a real escape — it must NOTICE you again before the next lock.
        // (Wariness carries the memory instead: the re-noticing is faster.)
        this.detection = 0;
        for (const s of this.systems) s.hunter = false;
        return grazed ? 'graze' : null;
      }
      this.lockTimer += dt;
      if (this.lockTimer >= this.effectiveStrikeSeconds) {
        this.done = true;
        return 'strike';
      }
      return null;
    }

    // Not locked yet: long enough above the threshold → a hunter locks on.
    // Wariness shortens the fuse.
    if (this.detection >= this.effectiveLockSeconds) {
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
