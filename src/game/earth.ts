import type { Body } from '../physics/Body.ts';
import { Trail } from '../render/trail.ts';

// Trisolaris climate model — a planet at the mercy of the suns (Liu Cixin's
// "The Three-Body Problem"). Insolation (heat from every star, ∝ mass/dist²)
// drives a "warmth"; warmth sets the era — a Stable Era when temperate, a
// Chaotic Era when scorching or frozen — and drives the population, which grows
// in stable temperate eras and crashes in the extremes. When a civilization is
// wiped out it reboots in the next stable era, as in the novel.
//
// Constants are game-feel-tuned (mixed pixel/mass units), not SI.

const WARMTH_REF = 1e-5; // insolation that reads as "comfortable" → warmth ≈ 1
const FROZEN_BELOW = 0.45;
const SCORCH_ABOVE = 2.5;
const POP_MAX = 10; // billions
const GROWTH = 0.45; // logistic growth rate in a stable era
const DECAY = 1.1; // population crash rate in a chaotic extreme
const EXTINCT_AT = 0.02;
const REBOOT_AT = 0.5;

export type Era = 'frozen' | 'temperate' | 'scorching';

export class EarthState {
  readonly body: Body;
  readonly trail: Trail;
  population = 1; // billions
  civilizations = 1; // count, Trisolaris-style: rises again after each wipe
  warmth = 1; // 1 ≈ comfortable; <FROZEN_BELOW frozen, >SCORCH_ABOVE scorching
  chaos = 0; // 0..1 smoothed climate volatility
  era: Era = 'temperate';
  private warmthEMA = 1;
  private extinct = false;

  constructor(body: Body) {
    this.body = body;
    this.trail = new Trail(700);
  }

  update(dt: number, suns: Body[]): void {
    let insolation = 0;
    for (const s of suns) {
      const dx = this.body.pos.x - s.pos.x;
      const dy = this.body.pos.y - s.pos.y;
      insolation += s.mass / Math.max(dx * dx + dy * dy, 1);
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

    if (this.era === 'temperate') {
      this.population += GROWTH * dt * (1 - this.population / POP_MAX);
      if (this.extinct && this.population >= REBOOT_AT) {
        this.civilizations++;
        this.extinct = false;
      }
    } else {
      // Scorching / frozen extremes burn or freeze the population away.
      this.population -= DECAY * dt * (this.population + 0.15);
      if (this.population <= EXTINCT_AT) {
        this.population = 0;
        this.extinct = true;
      }
    }
    this.population = Math.max(0, Math.min(POP_MAX, this.population));
  }

  // A Stable Era: temperate AND not lurching around. Everything else — the
  // extremes, or a temperate spell that's swinging hard — is a Chaotic Era.
  get stable(): boolean {
    return this.era === 'temperate' && this.chaos < 0.25;
  }
}
