import { describe, expect, it } from 'vitest';
import { headingOf } from '../../src/core/math';
import { Rng } from '../../src/core/rng';
import { createHoop, distanceBeyondArc, isThreePointZone } from '../../src/data/court';
import { MODES } from '../../src/data/modes';
import { NEUTRAL_MODIFIERS } from '../../src/data/modifiers';
import { getPlayer } from '../../src/data/players';
import { SIM_DT, STAMINA } from '../../src/data/tuning';
import { Button, emptyInput, type PlayerInput } from '../../src/sim/input';
import { Simulation } from '../../src/sim/Simulation';
import { classifyMoveTrigger } from '../../src/sim/systems/dribbling';
import { computeShotChance, gradeTiming, type ShotContext } from '../../src/sim/systems/shooting';
import { updateStamina } from '../../src/sim/systems/stamina';

const hoop = createHoop(1);

function ctx(overrides: Partial<ShotContext> = {}): ShotContext {
  return {
    type: 'jumper', rating: 70, distance: 5, beyondArc: false, deepMeters: 0, timing: 'good',
    contest: 0, staminaRatio: 1, movingSpeed: 0, mods: { ...NEUTRAL_MODIFIERS }, ...overrides,
  };
}

describe('court geometry', () => {
  it('classifies three-point zones including corners', () => {
    expect(isThreePointZone(hoop, 0, hoop.z - 7)).toBe(true);
    expect(isThreePointZone(hoop, 0, hoop.z - 6)).toBe(false);
    expect(isThreePointZone(hoop, 6.9, hoop.z)).toBe(true); // corner
    expect(isThreePointZone(hoop, 6.4, hoop.z)).toBe(false);
    expect(distanceBeyondArc(hoop, 0, hoop.z - 7.75)).toBeCloseTo(1, 5);
  });
});

describe('shot model', () => {
  it('is monotonic in rating, contest, timing and fatigue', () => {
    expect(computeShotChance(ctx({ rating: 90 })).total).toBeGreaterThan(computeShotChance(ctx({ rating: 60 })).total);
    expect(computeShotChance(ctx({ contest: 0.8 })).total).toBeLessThan(computeShotChance(ctx({ contest: 0.1 })).total);
    expect(computeShotChance(ctx({ timing: 'perfect' })).total).toBeGreaterThan(computeShotChance(ctx({ timing: 'good' })).total);
    expect(computeShotChance(ctx({ timing: 'poor' })).total).toBeLessThan(computeShotChance(ctx({ timing: 'early' })).total);
    expect(computeShotChance(ctx({ staminaRatio: 0.1 })).total).toBeLessThan(computeShotChance(ctx()).total);
  });

  it('breakdown factors add up to the total (explainable)', () => {
    const b = computeShotChance(ctx({ contest: 0.4, timing: 'late', staminaRatio: 0.3, distance: 6.2 }));
    const sum = b.base + b.distance + b.timing + b.contest + b.fatigue + b.movement + b.shotType;
    expect(b.total).toBeCloseTo(Math.min(0.97, Math.max(0.02, sum)), 10);
  });

  it('grades timing windows symmetrically', () => {
    const w = { perfect: 0.03, good: 0.08, ok: 0.16 };
    expect(gradeTiming(0.01, w)).toBe('perfect');
    expect(gradeTiming(-0.05, w)).toBe('good');
    expect(gradeTiming(-0.12, w)).toBe('early');
    expect(gradeTiming(0.12, w)).toBe('late');
    expect(gradeTiming(0.3, w)).toBe('poor');
  });
});

function soloSim(): Simulation {
  return new Simulation({ mode: MODES.oneOnOne, seed: 1, teams: [[{ def: getPlayer('dorian-vale') }], [{ def: getPlayer('caius-whitlock') }]], firstOffense: 0 });
}

function stepN(sim: Simulation, n: number, inputs: PlayerInput[]): void {
  for (let i = 0; i < n; i++) sim.step(inputs);
}

describe('possession and rules', () => {
  it('starts with a check, gives the ball to the offense and goes live', () => {
    const sim = soloSim();
    expect(sim.match.phase).toBe('check');
    expect(sim.ball.phase).toBe('held');
    expect(sim.players[sim.ball.holder]!.team).toBe(0);
    stepN(sim, Math.ceil(1.2 / SIM_DT), [emptyInput(), emptyInput()]);
    expect(sim.match.phase).toBe('live');
  });

  it('shot clock violation turns the ball over', () => {
    const sim = soloSim();
    stepN(sim, Math.ceil((1.2 + (MODES.oneOnOne.shotClock ?? 0) + 0.2) / SIM_DT), [emptyInput(), emptyInput()]);
    expect(sim.match.deadReason).toBe('shotClock');
    stepN(sim, Math.ceil(1.7 / SIM_DT), [emptyInput(), emptyInput()]);
    expect(sim.match.offense).toBe(1);
    expect(sim.players[sim.ball.holder]!.team).toBe(1);
  });

  it('a held shoot button starts a jumper and releasing it launches the ball', () => {
    const sim = soloSim();
    const inputs = [emptyInput(), emptyInput()];
    stepN(sim, Math.ceil(1.2 / SIM_DT), inputs);
    inputs[0]!.buttons = Button.Shoot;
    stepN(sim, 30, inputs);
    expect(sim.players[0]!.action.kind).toBe('shotGather');
    inputs[0]!.buttons = 0;
    sim.step(inputs);
    expect(sim.ball.phase).toBe('shot');
    expect(sim.players[0]!.stats.fga).toBe(1);
  });

  it('a quick tap on shoot is a pump fake (ball stays in hand)', () => {
    const sim = soloSim();
    const inputs = [emptyInput(), emptyInput()];
    stepN(sim, Math.ceil(1.2 / SIM_DT), inputs);
    inputs[0]!.buttons = Button.Shoot;
    stepN(sim, 3, inputs);
    inputs[0]!.buttons = 0;
    sim.step(inputs);
    expect(sim.players[0]!.action.kind).toBe('pumpFake');
    expect(sim.ball.phase).toBe('held');
  });
});

describe('dribble move classification', () => {
  it('maps stick directions relative to facing and ball hand', () => {
    const sim = soloSim();
    const p = sim.players[0]!;
    p.facing = headingOf(0, 1); // facing +Z
    p.hand = 1; // right hand; right vector is -X when facing +Z
    expect(classifyMoveTrigger(p, 0, 0).trigger).toBe('neutral');
    expect(classifyMoveTrigger(p, 0, 1).trigger).toBe('forward');
    expect(classifyMoveTrigger(p, 0, -1).trigger).toBe('back');
    expect(classifyMoveTrigger(p, 1, 0).trigger).toBe('offHandSide');
    expect(classifyMoveTrigger(p, -1, 0).trigger).toBe('ballHandSide');
    expect(classifyMoveTrigger(p, 1, -1).trigger).toBe('backDiagonal');
  });
});

describe('stamina', () => {
  it('drains while sprinting, recovers at rest and uses exhaustion hysteresis', () => {
    const sim = soloSim();
    const p = sim.players[0]!;
    p.sprinting = true;
    p.vel.x = 6;
    for (let i = 0; i < 60 * 30; i++) updateStamina(p, SIM_DT);
    expect(p.stamina).toBeLessThan(STAMINA.exhaustedBelow + 1);
    expect(p.exhausted).toBe(true);
    p.sprinting = false;
    p.vel.x = 0;
    for (let i = 0; i < 60; i++) updateStamina(p, SIM_DT);
    expect(p.exhausted).toBe(true); // still below recover threshold
    for (let i = 0; i < 60 * 5; i++) updateStamina(p, SIM_DT);
    expect(p.exhausted).toBe(false);
  });
});

describe('rng', () => {
  it('is reproducible and serializable', () => {
    const a = new Rng(42);
    a.next();
    const state = a.getState();
    const x = a.next();
    const b = new Rng(0);
    b.setState(state);
    expect(b.next()).toBe(x);
  });
});
