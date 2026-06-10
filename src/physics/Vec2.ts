// Plain 2D vector. We use a mutable record shape `{ x, y }` and standalone
// functions rather than a class — the PEFRL step touches body.pos.x / .y
// directly for performance, and a class wrapper would either force a heap
// allocation per step (with `new Vec2(...)`) or add a `this` indirection
// for no benefit. KISS.

export interface Vec2 {
  x: number;
  y: number;
}

export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

export function clone(v: Vec2): Vec2 {
  return { x: v.x, y: v.y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

export function magSq(v: Vec2): number {
  return v.x * v.x + v.y * v.y;
}

export function mag(v: Vec2): number {
  return Math.sqrt(magSq(v));
}

export function normalize(v: Vec2): Vec2 {
  const m = mag(v);
  return m > 0 ? { x: v.x / m, y: v.y / m } : { x: 0, y: 0 };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

// z-component of the cross product a × b in 2D (scalar). Used for angular
// momentum and signed area.
export function crossZ(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function distance(a: Vec2, b: Vec2): number {
  return mag(sub(a, b));
}

export function distanceSq(a: Vec2, b: Vec2): number {
  return magSq(sub(a, b));
}
