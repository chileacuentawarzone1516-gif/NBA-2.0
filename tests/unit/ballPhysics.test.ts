import { describe, expect, it } from 'vitest';
import { vec3 } from '../../src/core/math';
import { Rng } from '../../src/core/rng';
import { createHoop } from '../../src/data/court';
import { BALL, SIM_DT } from '../../src/data/tuning';
import { createContacts, integrateBall, resetContacts, solveLaunchVelocity } from '../../src/sim/systems/ballPhysics';
import { planShot, simulateShot } from '../../src/sim/systems/shooting';

const hoop = createHoop(1);

describe('ball physics', () => {
  it('bounces on the floor with decaying height and comes to rest', () => {
    const body = { pos: vec3(0, 2, 5), vel: vec3(0, 0, 0) };
    const contacts = createContacts();
    const peaks: number[] = [];
    let rising = false;
    let maxY = 0;
    for (let i = 0; i < 60 * 8; i++) {
      resetContacts(contacts);
      integrateBall(body, SIM_DT, hoop, contacts, { hoopCollision: true, netGuide: false });
      if (body.vel.y > 0) {
        rising = true;
        maxY = Math.max(maxY, body.pos.y);
      } else if (rising) {
        peaks.push(maxY);
        rising = false;
        maxY = 0;
      }
    }
    expect(peaks.length).toBeGreaterThan(2);
    for (let i = 1; i < peaks.length; i++) expect(peaks[i]!).toBeLessThan(peaks[i - 1]!);
    expect(body.pos.y).toBeCloseTo(BALL.radius, 3);
    expect(Math.abs(body.vel.y)).toBeLessThan(1e-6);
  });

  it('analytic launch solution passes through the rim center (exact integration)', () => {
    const from = vec3(0, 2.9, hoop.z - 7);
    const vel = vec3();
    solveLaunchVelocity(from, vec3(hoop.x, hoop.y, hoop.z), 1.6, vel);
    expect(simulateShot(hoop, from, vel)).toBe('make');
  });

  it('a clearly short shot hits the front rim and misses', () => {
    const from = vec3(0, 2.9, hoop.z - 6);
    const vel = vec3();
    solveLaunchVelocity(from, vec3(hoop.x, hoop.y, hoop.z - 0.3), 1.5, vel);
    expect(simulateShot(hoop, from, vel)).toBe('miss');
  });
});

describe('shot planner', () => {
  const positions = [
    { x: 0, dz: 7.2 }, // top three
    { x: 6.9, dz: 0.3 }, // corner three
    { x: -4.5, dz: 4.5 }, // wing mid-range
    { x: 0, dz: 4.2 }, // free-throw area
    { x: 2.5, dz: 1.5 }, // short baseline
    { x: -6, dz: 5 }, // left wing three
  ];

  it('produces a physical outcome matching the intended result almost always', () => {
    const rng = new Rng(1234);
    let matches = 0;
    let total = 0;
    for (const pos of positions) {
      for (let i = 0; i < 40; i++) {
        const intendedMake = i % 2 === 0;
        const release = vec3(pos.x, 2.75 + rng.range(0, 0.4), hoop.z - pos.dz);
        const plan = planShot(hoop, release, 'jumper', intendedMake, 'good', rng);
        total++;
        if ((plan.outcome === 'make') === intendedMake) matches++;
      }
    }
    expect(matches / total).toBeGreaterThan(0.97);
  });

  it('handles realistic release heights below the rim (regression: shots resolved as misses on the way up)', () => {
    const rng = new Rng(77);
    let matches = 0;
    let makes = 0;
    const total = 120;
    for (let i = 0; i < total; i++) {
      const intendedMake = i % 3 !== 0;
      const release = vec3(rng.range(-6, 6), rng.range(2.2, 2.6), hoop.z - rng.range(3, 7.5));
      const plan = planShot(hoop, release, 'jumper', intendedMake, 'good', rng);
      if ((plan.outcome === 'make') === intendedMake) matches++;
      if (plan.outcome === 'make') makes++;
    }
    expect(makes).toBeGreaterThan(total * 0.5);
    expect(matches / total).toBeGreaterThan(0.97);
  });

  it('is deterministic for the same seed', () => {
    const a = planShot(hoop, vec3(1, 2.9, hoop.z - 6), 'jumper', false, 'good', new Rng(99));
    const b = planShot(hoop, vec3(1, 2.9, hoop.z - 6), 'jumper', false, 'good', new Rng(99));
    expect(a.velocity).toEqual(b.velocity);
  });
});
