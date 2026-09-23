import { it } from 'vitest';
import { SIM_DT } from '../../src/data/tuning';
import type { DifficultyId } from '../../src/data/difficulty';
import type { ModeId } from '../../src/data/modes';
import { TEAMS } from '../../src/data/teams';
import { createMatch } from '../../src/game/matchFactory';

/**
 * Balance report (dev tool): runs many AI-vs-AI matches and prints aggregate stats.
 * Run with `npm run balance`. Not part of the regular test suite.
 */
const MATCHES = Number(process.env.BALANCE_MATCHES ?? 24);
const NO_HUMANS = new Set<number>();

function report(mode: ModeId, difficulty: DifficultyId): void {
  const agg = { fgm: 0, fga: 0, tpm: 0, tpa: 0, pts: 0, reb: 0, oreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, dunks: 0, poss: 0, seconds: 0, perfect: 0, releases: 0, moves: 0, beaten: 0, passes: 0, ot: 0, reach: 0, reachHit: 0, deflRecovered: 0, intendedMakes: 0, intendedButMissed: 0, blockedIntended: 0, uncounted: 0, shotClockViol: 0 };
  const byType = new Map<string, { a: number; m: number; pct: number; contest: number }>();
  for (let i = 0; i < MATCHES; i++) {
    const home = TEAMS[i % TEAMS.length]!;
    const away = TEAMS[(i + 1 + (i % 3)) % TEAMS.length]!;
    const { sim, ai, inputs } = createMatch({ mode, seed: 1000 + i, difficulty, homeTeamId: home.id, awayTeamId: away.id });
    let lastShotType = '';
    let pendingIntended: typeof sim.ball.shot = null;
    while (!sim.isOver() && sim.time < 1500) {
      ai.update(sim, SIM_DT, inputs, NO_HUMANS);
      sim.step(inputs);
      for (const e of sim.events) {
        if (e.type === 'possession') agg.poss++;
        if (e.type === 'shotRelease') {
          agg.releases++;
          if (e.timing === 'perfect') agg.perfect++;
          lastShotType = e.points === 3 ? 'three' : e.shotType;
          const t = byType.get(lastShotType) ?? { a: 0, m: 0, pct: 0, contest: 0 };
          t.a++;
          t.pct += e.pct;
          t.contest += e.contest;
          byType.set(lastShotType, t);
        }
        if (e.type === 'score' && e.counted) {
          const t = byType.get(e.points === 3 ? 'three' : e.shotType);
          if (t) t.m++;
        }
        if (e.type === 'dribbleMove') agg.moves++;
        if (e.type === 'shotRelease' && sim.ball.shot?.intendedMake) {
          agg.intendedMakes++;
          pendingIntended = sim.ball.shot;
        }
        if (e.type === 'miss' && pendingIntended && sim.ball.shot === pendingIntended) {
          agg.intendedButMissed++;
          if (process.env.BALANCE_TRACE) {
            const sh = pendingIntended;
            const shooter = sim.players[sh.shooter]!;
            console.info('intended make missed', sh.type, 'dist', sh.distance.toFixed(2), 'shooter', shooter.pos.x.toFixed(2), shooter.pos.z.toFixed(2), 'blocked', sh.blocked);
          }
          pendingIntended = null;
        }
        if (e.type === 'block' && pendingIntended) {
          agg.blockedIntended++;
          pendingIntended = null;
        }
        if (e.type === 'score') pendingIntended = null;
        if (e.type === 'score' && !e.counted) agg.uncounted++;
        if (e.type === 'turnover' && e.reason === 'shotClock') agg.shotClockViol++;
        if (e.type === 'defenderBeaten') agg.beaten++;
        if (e.type === 'pass') agg.passes++;
        if (e.type === 'stealMiss') agg.reach++;
        if (e.type === 'deflection') {
          agg.reach++;
          agg.reachHit++;
        }
      }
    }
    if (sim.match.overtime) agg.ot++;
    agg.seconds += sim.time;
    for (const p of sim.players) {
      agg.fgm += p.stats.fgm; agg.fga += p.stats.fga; agg.tpm += p.stats.tpm; agg.tpa += p.stats.tpa;
      agg.pts += p.stats.points; agg.reb += p.stats.oreb + p.stats.dreb; agg.oreb += p.stats.oreb;
      agg.ast += p.stats.assists; agg.stl += p.stats.steals; agg.blk += p.stats.blocks; agg.tov += p.stats.turnovers; agg.dunks += p.stats.dunks;
    }
  }
  const pg = (v: number) => (v / MATCHES).toFixed(1);
  const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) : '-') + '%';
  console.info(
    `\n== ${mode} / ${difficulty} (${MATCHES} matches) ==\n` +
      `FG ${pct(agg.fgm, agg.fga)}  3P ${pct(agg.tpm, agg.tpa)}  3PA rate ${pct(agg.tpa, agg.fga)}  pts/g ${pg(agg.pts)}  FGA/g ${pg(agg.fga)}\n` +
      `reb/g ${pg(agg.reb)} (OREB ${pct(agg.oreb, agg.reb)})  ast/g ${pg(agg.ast)}  stl/g ${pg(agg.stl)}  blk/g ${pg(agg.blk)}  tov/g ${pg(agg.tov)}  dunks/g ${pg(agg.dunks)}\n` +
      `perfect ${pct(agg.perfect, agg.releases)}  moves/g ${pg(agg.moves)}  beaten/g ${pg(agg.beaten)}  passes/g ${pg(agg.passes)}  steal reaches/g ${pg(agg.reach)} (hit ${pct(agg.reachHit, agg.reach)})  intended makes ${agg.intendedMakes} (missed by physics ${agg.intendedButMissed}, blocked ${agg.blockedIntended}, uncleared ${agg.uncounted}) shot-clock viol ${agg.shotClockViol}  OT ${agg.ot}  avg length ${(agg.seconds / MATCHES).toFixed(0)}s\n` +
      [...byType.entries()].map(([k, v]) => `${k}: ${v.m}/${v.a} ${pct(v.m, v.a)} (exp ${((100 * v.pct) / v.a).toFixed(0)}% c${(v.contest / v.a).toFixed(2)})`).join('  '),
  );
}

it('balance report', () => {
  const modes = (process.env.BALANCE_MODES ?? 'oneOnOne,threeOnThree').split(',') as ModeId[];
  const diffs = (process.env.BALANCE_DIFFS ?? 'pro').split(',') as DifficultyId[];
  for (const mode of modes) for (const d of diffs) report(mode, d);
}, 600_000);
