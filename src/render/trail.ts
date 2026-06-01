import { rgba } from '../theme.ts';

// Ring buffer of past positions. Drawn as a polyline with per-segment alpha
// that fades from `tailAlpha` at the oldest end to `headAlpha` at the newest.

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

  // Iterate oldest → newest
  *iter(): IterableIterator<{ x: number; y: number; t: number }> {
    const n = this.points.length;
    if (n === 0) return;
    const start = this.filled ? this.write : 0;
    for (let i = 0; i < n; i++) {
      const idx = (start + i) % n;
      yield { ...this.points[idx], t: i / (n - 1 || 1) };
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

  let prev: { x: number; y: number; t: number } | null = null;
  for (const p of trail.iter()) {
    if (prev !== null) {
      const t = (prev.t + p.t) / 2;
      const a = tailAlpha + (headAlpha - tailAlpha) * t;
      ctx.strokeStyle = rgba(color, a);
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    prev = p;
  }
  ctx.restore();
}
