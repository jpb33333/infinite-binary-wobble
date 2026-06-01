import { rgba } from '../theme.ts';

// Ring buffer of past positions. Drawn as a polyline with per-segment alpha
// that fades from `tailAlpha` at the oldest end to `headAlpha` at the newest.
//
// Iteration is allocation-free: the previous design yielded a fresh
// `{ x, y, t }` per point, which at capacity 700 × 2 trails generated
// ~1400 small objects per render frame. We replaced the generator with a
// callback-style `forEach(x, y, t)` so drawTrail does zero heap traffic
// while painting. (Caught by /qa Layer 4 allocation audit.)

export class Trail {
  private points: { x: number; y: number }[] = [];
  private capacity: number;
  private write = 0;
  private filled = false;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  push(x: number, y: number): void {
    if (this.points.length < this.capacity) {
      this.points.push({ x, y });
    } else {
      this.points[this.write] = { x, y };
    }
    this.write = (this.write + 1) % this.capacity;
    if (this.points.length >= this.capacity) this.filled = true;
  }

  reset(): void {
    this.points = [];
    this.write = 0;
    this.filled = false;
  }

  // Iterate oldest → newest, allocation-free. The callback receives raw
  // coordinates plus a normalised age `t ∈ [0, 1]` (0 = oldest, 1 = newest).
  forEach(cb: (x: number, y: number, t: number) => void): void {
    const n = this.points.length;
    if (n === 0) return;
    const start = this.filled ? this.write : 0;
    const denom = n > 1 ? n - 1 : 1;
    for (let i = 0; i < n; i++) {
      const idx = (start + i) % n;
      const p = this.points[idx];
      cb(p.x, p.y, i / denom);
    }
  }
}

export function drawTrail(
  ctx: CanvasRenderingContext2D,
  trail: Trail,
  color: string,
  headAlpha: number = 0.85,
  tailAlpha: number = 0,
  width: number = 2.2,
): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = width;

  let havePrev = false;
  let prevX = 0;
  let prevY = 0;
  let prevT = 0;
  trail.forEach((x, y, t) => {
    if (havePrev) {
      const midT = (prevT + t) * 0.5;
      const a = tailAlpha + (headAlpha - tailAlpha) * midT;
      ctx.strokeStyle = rgba(color, a);
      ctx.beginPath();
      ctx.moveTo(prevX, prevY);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    prevX = x;
    prevY = y;
    prevT = t;
    havePrev = true;
  });
  ctx.restore();
}
