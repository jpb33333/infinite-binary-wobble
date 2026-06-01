import { palette, rgba } from '../theme.ts';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  color: string;
}

// Stardust system. Two responsibilities:
//   - Ambient drift across the whole canvas at all times (slow, low-density)
//   - On-demand bursts (e.g. when bodies collide)
//
// Global cap: 300 particles. Defends against console-spam DoS — burst()
// silently drops anything over the cap rather than letting the array grow
// unboundedly. Ambient (~36) plus the largest legitimate burst (~80) leaves
// ample headroom. (Caught by /qa Layer 15 DoS audit.)
const MAX_PARTICLES = 300;

export class Particles {
  private particles: Particle[] = [];
  private rng: () => number;

  constructor(seed: number = 0xfeed) {
    this.rng = mulberry32(seed);
  }

  // Continuously emits a slow drift so the void feels alive. Call per frame.
  ambient(width: number, height: number, dt: number, target: number = 36): void {
    const cap = Math.min(target, MAX_PARTICLES);
    while (this.particles.length < cap) {
      this.spawnDrift(width, height);
    }
    this.update(dt, width, height);
  }

  burst(x: number, y: number, count: number, color: string, speed: number = 220): void {
    const room = MAX_PARTICLES - this.particles.length;
    const n = Math.min(count, Math.max(0, room));
    for (let i = 0; i < n; i++) {
      const angle = this.rng() * Math.PI * 2;
      const s = speed * (0.3 + this.rng() * 0.7);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * s,
        vy: Math.sin(angle) * s,
        age: 0,
        life: 0.8 + this.rng() * 1.0,
        size: 1.5 + this.rng() * 2.5,
        color,
      });
    }
  }

  private spawnDrift(width: number, height: number): void {
    const warm = this.rng();
    this.particles.push({
      x: this.rng() * width,
      y: this.rng() * height,
      vx: (this.rng() - 0.5) * 6,
      vy: (this.rng() - 0.5) * 6,
      age: 0,
      life: 4 + this.rng() * 6,
      size: 0.8 + this.rng() * 1.2,
      color: warm < 0.5 ? palette.cream : palette.rose,
    });
  }

  private update(dt: number, width: number, height: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.age += dt;
      if (p.age >= p.life || p.x < -20 || p.x > width + 20 || p.y < -20 || p.y > height + 20) {
        // Swap-remove
        this.particles[i] = this.particles[this.particles.length - 1];
        this.particles.pop();
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      const fade = 1 - p.age / p.life;
      const a = Math.max(0, Math.min(1, fade));
      ctx.fillStyle = rgba(p.color, a * 0.7);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
