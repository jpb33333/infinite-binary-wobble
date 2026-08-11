import type { Body } from '../physics/Body.ts';
import { Trail } from '../render/trail.ts';

// Climate-and-population model for a world adrift in a multi-star system. Insolation
// (heat from every star, ∝ mass/dist²) drives a "warmth"; warmth sets the era — a
// Steady Era when temperate, a Turbulent Era when scorching or frozen — and drives the
// population, which grows in steady temperate eras and crashes in the extremes. When the
// population is wiped out it rises again once the climate steadies — each recovery a new
// "dawn".
//
// Constants are game-feel-tuned (mixed pixel/mass units), not SI.

const WARMTH_REF = 1e-5; // insolation that reads as "comfortable" → warmth ≈ 1
const FROZEN_BELOW = 0.32;
const SCORCH_ABOVE = 3.0;
const POP_MAX = 10; // billions
const GROWTH = 0.55; // logistic growth rate in a steady era
const DECAY = 0.75; // population crash rate in a turbulent extreme
const DARK_DECAY = 0.15;
// Frozen-era crash rate multiplier: a frozen civilization dehydrates and
// endures (the Trisolaran survival trick) — cold is dormancy, not the fire.
const FROZEN_DORMANCY = 0.5; // gentle wane while the civilization is "running dark" (Act III)
const EXTINCT_AT = 0.02;
const REBOOT_AT = 0.25;

export type Era = 'frozen' | 'temperate' | 'scorching';

export class WorldState {
  readonly body: Body;
  readonly trail: Trail;
  population = 1; // billions
  dawns = 1; // how many times life has risen here — a new dawn after each recovery
  warmth = 1; // 1 ≈ comfortable; <FROZEN_BELOW frozen, >SCORCH_ABOVE scorching
  chaos = 0; // 0..1 smoothed climate volatility
  era: Era = 'temperate';
  // Ejection warning, set by the Game each frame: how far the planet has drifted
  // toward the eject boundary (0 = home … 1 = at/past it) and how long it has
  // been past. Drives the on-planet "adrift" warning + the grace before it's lost.
  driftFraction = 0;
  secondsAdrift = 0;
  private warmthEMA = 1;
  private extinct = false;

  constructor(body: Body) {
    this.body = body;
    this.trail = new Trail(700);
  }

  update(dt: number, suns: Body[], suppressed = false): void {
    let insolation = 0;
    for (const s of suns) {
      const dx = this.body.pos.x - s.pos.x;
      const dy = this.body.pos.y - s.pos.y;
      const dz = this.body.z - s.z;
      insolation += s.mass / Math.max(dx * dx + dy * dy + dz * dz, 1);
    }
    const warmth = insolation / WARMTH_REF;

    // Volatility: how far warmth is leaping from its smoothed baseline. A
    // steady temperate climate → ~0; wild swings of the chaotic suns → ~1.
    const volatility = Math.min(1, Math.abs(warmth - this.warmthEMA) * 1.5);
    this.chaos += (volatility - this.chaos) * Math.min(1, dt * 2);
    this.warmthEMA += (warmth - this.warmthEMA) * Math.min(1, dt * 0.6);
    this.warmth = warmth;
    this.era =
      warmth < FROZEN_BELOW ? 'frozen' : warmth > SCORCH_ABOVE ? 'scorching' : 'temperate';

    if (suppressed) {
      // The civilization has gone dark (Act III): powered down to hide from the
      // forest. No growth even in a steady era, and a gentle decline — so hiding
      // too long withers life toward extinction. The cost of silence.
      this.population -= DARK_DECAY * dt * (this.population + 0.15);
      if (this.population <= EXTINCT_AT) {
        this.population = 0;
        this.extinct = true;
      }
    } else if (this.era === 'temperate') {
      this.population += GROWTH * dt * (1 - this.population / POP_MAX);
      if (this.extinct && this.population >= REBOOT_AT) {
        this.dawns++;
        this.extinct = false;
      }
    } else {
      // Scorching burns at the full rate; frozen decays at half — dehydrated
      // dormancy through the cold eras, the way the Trisolarans endure.
      const rate = this.era === 'frozen' ? DECAY * FROZEN_DORMANCY : DECAY;
      this.population -= rate * dt * (this.population + 0.15);
      if (this.population <= EXTINCT_AT) {
        this.population = 0;
        this.extinct = true;
      }
    }
    this.population = Math.max(0, Math.min(POP_MAX, this.population));
  }

  // A Steady Era: temperate AND not lurching around. Everything else — the
  // extremes, or a temperate spell that's swinging hard — is a Turbulent Era.
  get stable(): boolean {
    return this.era === 'temperate' && this.chaos < 0.25;
  }
}
