import { describe, test, expect } from 'vitest';
import { createBody } from '../src/physics/Body.ts';
import { vec2 } from '../src/physics/Vec2.ts';
import { EarthState } from '../src/game/earth.ts';

// The Trisolaris climate model: insolation → warmth → era → population. A
// temperate era grows a civilization; a scorching/frozen era burns or freezes
// it away. (WARMTH_REF in earth.ts is tuned so a mass-2.5 sun at ~500px reads
// as warmth ≈ 1, comfortably temperate.)

describe('Earth climate + population', () => {
  test('a temperate era grows the population', () => {
    const earth = new EarthState(createBody(0.02, vec2(0, 0), vec2(0, 0)));
    const sun = createBody(2.5, vec2(500, 0), vec2(0, 0)); // warmth ≈ 1
    earth.population = 1;
    for (let i = 0; i < 300; i++) earth.update(1 / 60, [sun]);
    expect(earth.era).toBe('temperate');
    expect(earth.population).toBeGreaterThan(1);
  });

  test('a scorching era crashes the population', () => {
    const earth = new EarthState(createBody(0.02, vec2(0, 0), vec2(0, 0)));
    const sun = createBody(5, vec2(150, 0), vec2(0, 0)); // suns crowd close → scorching
    earth.population = 5;
    for (let i = 0; i < 300; i++) earth.update(1 / 60, [sun]);
    expect(earth.era).toBe('scorching');
    expect(earth.population).toBeLessThan(5);
  });

  test('a frozen era (suns far) is chaotic, not stable', () => {
    const earth = new EarthState(createBody(0.02, vec2(0, 0), vec2(0, 0)));
    const sun = createBody(1, vec2(2000, 0), vec2(0, 0)); // warmth ≪ 1 → frozen
    for (let i = 0; i < 120; i++) earth.update(1 / 60, [sun]);
    expect(earth.era).toBe('frozen');
    expect(earth.stable).toBe(false);
  });
});
