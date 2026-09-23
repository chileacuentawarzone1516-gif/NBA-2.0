import { describe, expect, it } from 'vitest';
import { isFiniteVec3 } from '../../src/core/math';
import { SIM_DT } from '../../src/data/tuning';
import { createMatch, type MatchConfig } from '../../src/game/matchFactory';
import type { SimEvent } from '../../src/sim/types';

const NO_HUMANS = new Set<number>();

function runMatch(config: MatchConfig, maxSeconds = 1200) {
  const match = createMatch(config);
  const { sim, ai, inputs } = match;
  const counts = new Map<SimEvent['type'], number>();
  const timings = new Map<string, number>();
  let ticks = 0;
  const maxTicks = Math.ceil(maxSeconds / SIM_DT);
  while (!sim.isOver() && ticks < maxTicks) {
    ai.update(sim, SIM_DT, inputs, NO_HUMANS);
    sim.step(inputs);
    ticks++;
    for (const e of sim.events) {
      counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
      if (e.type === 'shotRelease') timings.set(e.timing, (timings.get(e.timing) ?? 0) + 1);
    }
    for (const p of sim.players) {
      if (!isFiniteVec3(p.pos)) throw new Error(`Player ${p.id} has a non-finite position at tick ${ticks}`);
    }
    if (!isFiniteVec3(sim.ball.pos)) throw new Error(`Ball has a non-finite position at tick ${ticks}`);
  }
  return { sim, ticks, counts, timings };
}

function teamTotals(sim: ReturnType<typeof runMatch>['sim']) {
  const totals = { points: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0 };
  for (const p of sim.players) {
    totals.points += p.stats.points;
    totals.fgm += p.stats.fgm;
    totals.fga += p.stats.fga;
    totals.tpm += p.stats.tpm;
    totals.tpa += p.stats.tpa;
    totals.reb += p.stats.oreb + p.stats.dreb;
    totals.ast += p.stats.assists;
    totals.stl += p.stats.steals;
    totals.blk += p.stats.blocks;
    totals.tov += p.stats.turnovers;
  }
  return totals;
}

describe('headless AI vs AI matches', () => {
  it('1v1 plays to completion with consistent scoring', () => {
    const { sim, counts, timings } = runMatch({ mode: 'oneOnOne', seed: 7, difficulty: 'pro', homeTeamId: 'comets', awayTeamId: 'tides' });
    const totals = teamTotals(sim);
    console.info('1v1', sim.match.score, totals, Object.fromEntries(counts), Object.fromEntries(timings), 'time', sim.time.toFixed(1));
    expect(sim.isOver()).toBe(true);
    expect(sim.match.winner).not.toBe(-1);
    expect(sim.match.score[0] + sim.match.score[1]).toBe(totals.points);
    expect(totals.fga).toBeGreaterThan(8);
    expect(counts.get('possession') ?? 0).toBeGreaterThan(4);
  });

  it('3v3 plays to completion with passes, rebounds and assists', () => {
    const { sim, counts } = runMatch({ mode: 'threeOnThree', seed: 21, difficulty: 'allStar', homeTeamId: 'foxes', awayTeamId: 'owls' });
    const totals = teamTotals(sim);
    console.info('3v3', sim.match.score, totals, Object.fromEntries(counts), 'time', sim.time.toFixed(1));
    expect(sim.isOver()).toBe(true);
    expect(sim.match.score[0] + sim.match.score[1]).toBe(totals.points);
    expect(counts.get('pass') ?? 0).toBeGreaterThan(5);
    expect(totals.reb).toBeGreaterThan(3);
  });

  it('is deterministic for the same seed and configuration', () => {
    const config: MatchConfig = { mode: 'threeOnThree', seed: 99, difficulty: 'pro', homeTeamId: 'vipers', awayTeamId: 'bison' };
    const a = runMatch(config, 90);
    const b = runMatch(config, 90);
    expect(a.ticks).toBe(b.ticks);
    expect(a.sim.match.score).toEqual(b.sim.match.score);
    expect(a.sim.players.map((p) => [p.pos.x, p.pos.z])).toEqual(b.sim.players.map((p) => [p.pos.x, p.pos.z]));
  });

  it('higher difficulty wins through better decisions/execution (same rosters)', () => {
    let legendWins = 0;
    const games = 8;
    for (let i = 0; i < games; i++) {
      // Mirror matchups: the same two teams, legend alternating sides.
      const legendHome = i % 2 === 0;
      const { sim } = runMatch({
        mode: 'threeOnThree',
        seed: 500 + i,
        difficulty: legendHome ? 'legend' : 'rookie',
        awayDifficulty: legendHome ? 'rookie' : 'legend',
        homeTeamId: legendHome ? 'comets' : 'tides',
        awayTeamId: legendHome ? 'tides' : 'comets',
      });
      if (sim.match.winner === (legendHome ? 0 : 1)) legendWins++;
    }
    console.info(`legend won ${legendWins}/${games} vs rookie`);
    expect(legendWins).toBeGreaterThanOrEqual(6);
  });

  it('simulates fast enough for mobile (well under the 16.6 ms frame budget)', () => {
    const match = createMatch({ mode: 'threeOnThree', seed: 3, difficulty: 'legend', homeTeamId: 'comets', awayTeamId: 'foxes' });
    const { sim, ai, inputs } = match;
    const start = performance.now();
    const steps = 60 * 60;
    for (let i = 0; i < steps && !sim.isOver(); i++) {
      ai.update(sim, SIM_DT, inputs, NO_HUMANS);
      sim.step(inputs);
    }
    const perStep = (performance.now() - start) / steps;
    console.info(`sim+ai cost per step: ${perStep.toFixed(4)} ms`);
    expect(perStep).toBeLessThan(1);
  });
});
