import { describe, test, expect } from 'vitest';
import { createBody } from '../src/physics/Body.ts';
import { vec2 } from '../src/physics/Vec2.ts';
import { WorldState } from '../src/game/world.ts';

// The world climate model: insolation → warmth → era → population. A temperate
// era grows the population; a scorching/frozen era burns or freezes it away.
// (WARMTH_REF in world.ts is tuned so a mass-2.5 sun at ~500px reads as
// warmth ≈ 1, comfortably temperate.)

describe('World climate + population', () => {
  test('a temperate era grows the population', () => {
    const world = new WorldState(createBody(0.02, vec2(0, 0), vec2(0, 0)));
    const sun = createBody(2.5, vec2(500, 0), vec2(0, 0)); // warmth ≈ 1
    world.population = 1;
    for (let i = 0; i < 300; i++) world.update(1 / 60, [sun]);
    expect(world.era).toBe('temperate');
    expect(world.population).toBeGreaterThan(1);
  });

  test('a scorching era crashes the population', () => {
    const world = new WorldState(createBody(0.02, vec2(0, 0), vec2(0, 0)));
    const sun = createBody(5, vec2(150, 0), vec2(0, 0)); // suns crowd close → scorching
    world.population = 5;
    for (let i = 0; i < 300; i++) world.update(1 / 60, [sun]);
    expect(world.era).toBe('scorching');
    expect(world.population).toBeLessThan(5);
  });

  test('a frozen era (suns far) is turbulent, not steady', () => {
    const world = new WorldState(createBody(0.02, vec2(0, 0), vec2(0, 0)));
    const sun = createBody(1, vec2(2000, 0), vec2(0, 0)); // warmth ≪ 1 → frozen
    for (let i = 0; i < 120; i++) world.update(1 / 60, [sun]);
    expect(world.era).toBe('frozen');
    expect(world.stable).toBe(false);
  });
});
