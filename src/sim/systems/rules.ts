import { copy3, headingOf } from '../../core/math';
import { distanceBeyondArc, fromHoopLocal } from '../../data/court';
import { RULES } from '../../data/tuning';
import { resetAction } from '../playerFactory';
import { otherTeam, type DeadReason, type ShotInfo, type SimPlayer, type TeamIndex } from '../types';
import { emit, type World } from '../world';
import { giveBall, makeDead, setOffense } from './possession';

/**
 * Half-court rules: check ball, clear-the-ball, shot clock, game clock with buzzer
 * beaters, target score, sudden-death overtime and practice resets.
 */

/** Hoop-local (lateral, out) formation spots by team size. Slot 0 is the ball handler. */
const OFFENSE_SPOTS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  1: [[0, 8.4]],
  2: [[-1.2, 8.4], [5.2, 3.2]],
  3: [[0, 8.4], [-5.4, 4.4], [5.4, 4.4]],
  5: [[0, 8.6], [-5.8, 5.2], [5.8, 5.2], [-2.6, 1.6], [2.6, 1.6]],
};

export function formationSpot(world: World, slot: number, teamSize: number, offense: boolean): { x: number; z: number } {
  const spots = OFFENSE_SPOTS[teamSize] ?? OFFENSE_SPOTS[3]!;
  const [lateral, out] = spots[Math.min(slot, spots.length - 1)]!;
  if (offense) return fromHoopLocal(world.hoop, lateral, out);
  // Defenders line up between their man and the rim.
  const gap = slot === 0 ? 1.8 : 1.5;
  const len = Math.hypot(lateral, out) || 1;
  return fromHoopLocal(world.hoop, lateral * (1 - gap / len), out * (1 - gap / len));
}

/** Primary ball handler: best handle + passing on the team. */
export function primaryHandler(world: World, team: TeamIndex): SimPlayer {
  let best: SimPlayer | null = null;
  let bestScore = -1;
  for (const p of world.players) {
    if (p.team !== team) continue;
    const score = p.attr.ballHandle + p.attr.passing * 0.6;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  if (!best) throw new Error(`Team ${team} has no players`);
  return best;
}

export function setupCheck(world: World, offense: TeamIndex): void {
  const { match } = world;
  const teamSize = world.mode.teamSize;
  const handler = primaryHandler(world, offense);

  // Handler takes slot 0; the rest fill remaining spots in roster order.
  const order = new Map<number, number>();
  for (const team of [0, 1] as const) {
    let next = 1;
    const primary = team === offense ? handler.id : primaryHandlerIdForDefense(world, team, handler);
    for (const p of world.players) {
      if (p.team !== team) continue;
      order.set(p.id, p.id === primary ? 0 : next++);
    }
  }

  for (const p of world.players) {
    const slot = order.get(p.id) ?? 0;
    const spot = formationSpot(world, slot, teamSize, p.team === offense);
    p.pos.x = spot.x;
    p.pos.y = 0;
    p.pos.z = spot.z;
    copy3(p.prevPos, p.pos);
    p.vel.x = 0;
    p.vel.z = 0;
    p.vy = 0;
    p.airborne = false;
    p.boostTime = 0;
    p.inStance = false;
    p.sprinting = false;
    resetAction(p.action);
    p.facing = headingOf(world.hoop.x - p.pos.x, world.hoop.z - p.pos.z);
    p.prevFacing = p.facing;
  }
  // Defenders face their offensive counterparts.
  for (const p of world.players) {
    if (p.team === offense) continue;
    const slot = order.get(p.id) ?? 0;
    const mark = formationSpot(world, slot, teamSize, true);
    p.facing = headingOf(mark.x - p.pos.x, mark.z - p.pos.z);
    p.prevFacing = p.facing;
  }

  if (match.offense !== offense || match.tick === 0) setOffense(world, offense, false);
  match.offense = offense;
  match.shotClock = world.mode.shotClock;
  match.needsClear = false;
  match.phase = 'check';
  match.phaseTime = 0;
  match.deadReason = 'none';
  world.ball.shot = null;
  giveBall(world, handler, 'check');
  emit(world, { type: 'phase', phase: 'check', offense });
}

/** The defender who picks up the ball handler is the best perimeter defender. */
function primaryHandlerIdForDefense(world: World, team: TeamIndex, handler: SimPlayer): number {
  let best = -1;
  let bestScore = -1;
  for (const p of world.players) {
    if (p.team !== team) continue;
    const score = p.attr.perimeterDefense + p.attr.speed * 0.3 - Math.abs(p.height - handler.height) * 20;
    if (score > bestScore) {
      bestScore = score;
      best = p.id;
    }
  }
  return best;
}

function setDead(world: World, reason: DeadReason, nextOffense: TeamIndex): void {
  const { match } = world;
  makeDead(world);
  match.phase = 'dead';
  match.phaseTime = 0;
  match.deadReason = reason;
  match.nextOffense = nextOffense;
  emit(world, { type: 'dead', reason });
  emit(world, { type: 'phase', phase: 'dead', offense: match.offense });
}

export function onScore(world: World, shot: ShotInfo): void {
  const { match, mode, ball } = world;
  const shooter = world.players[shot.shooter];
  shot.scored = true;
  shot.resolved = true;
  ball.netTime = 0.55;
  const counted = !shot.uncleared;
  const assist = counted ? shot.assist : -1;
  emit(world, { type: 'score', player: shot.shooter, team: shot.team, points: counted ? shot.points : 0, shotType: shot.type, assist, counted });
  emit(world, { type: 'net' });

  if (!counted) {
    if (shooter) {
      shooter.stats.turnovers++;
      emit(world, { type: 'turnover', player: shooter.id, team: shooter.team, reason: 'clearViolation' });
    }
    setDead(world, 'clearViolation', otherTeam(shot.team));
    return;
  }

  match.score[shot.team] += shot.points;
  if (shooter) {
    shooter.stats.points += shot.points;
    shooter.stats.fgm++;
    if (shot.points === 3) shooter.stats.tpm++;
    if (shot.type === 'dunk') shooter.stats.dunks++;
  }
  if (assist >= 0) {
    const passer = world.players[assist];
    if (passer) passer.stats.assists++;
  }
  if (mode.practice) {
    setDead(world, 'practiceReset', shot.team);
    return;
  }
  setDead(world, 'score', mode.makeItTakeIt ? shot.team : otherTeam(shot.team));
}

export function onOutOfBounds(world: World): void {
  const { ball, mode } = world;
  if (mode.practice) {
    returnBallInPractice(world);
    return;
  }
  const lastTouch = world.players[ball.lastTouch];
  if (lastTouch && lastTouch.team === world.match.offense) {
    lastTouch.stats.turnovers++;
    emit(world, { type: 'turnover', player: lastTouch.id, team: lastTouch.team, reason: 'outOfBounds' });
  }
  setDead(world, 'outOfBounds', otherTeam(ball.lastTouchTeam));
}

function returnBallInPractice(world: World): void {
  const player = world.players.find((p) => p.team === 0);
  if (!player) return;
  resetAction(player.action);
  world.match.phase = 'live';
  world.match.phaseTime = 0;
  giveBall(world, player, 'practice');
}

function isGameOver(world: World): boolean {
  const { match, mode } = world;
  const [a, b] = match.score;
  if (mode.targetScore !== null && Math.max(a, b) >= mode.targetScore) return true;
  if (match.overtime && a !== b) return true;
  return match.horn && a !== b;
}

function finish(world: World): void {
  const { match } = world;
  const [a, b] = match.score;
  match.phase = 'final';
  match.phaseTime = 0;
  match.winner = a > b ? 0 : 1;
  makeDead(world);
  emit(world, { type: 'phase', phase: 'final', offense: match.offense });
  emit(world, { type: 'gameEnd', winner: match.winner, score: [a, b] });
}

function endRegulation(world: World): void {
  const { match } = world;
  if (match.score[0] !== match.score[1]) {
    finish(world);
    return;
  }
  // Sudden death: next basket wins.
  match.overtime = true;
  match.horn = false;
  match.gameClock = null;
  setupCheck(world, world.rng.chance(0.5) ? 0 : 1);
}

export function updateRules(world: World, dt: number): void {
  const { match, mode, ball } = world;
  match.phaseTime += dt;

  switch (match.phase) {
    case 'check':
      if (match.phaseTime >= RULES.checkFreezeSeconds) {
        match.phase = 'live';
        match.phaseTime = 0;
        emit(world, { type: 'phase', phase: 'live', offense: match.offense });
      }
      return;
    case 'dead':
      if (mode.practice && match.deadReason === 'practiceReset' && match.phaseTime >= 0.9) {
        returnBallInPractice(world);
        return;
      }
      if (match.phaseTime >= RULES.deadBallSeconds) {
        if (isGameOver(world)) finish(world);
        else if (match.horn) endRegulation(world);
        else setupCheck(world, match.nextOffense);
      }
      return;
    case 'final':
      return;
    case 'live':
      break;
  }

  if (mode.practice) {
    if (ball.phase === 'loose' && ball.restTime > 1.4) returnBallInPractice(world);
    return;
  }

  if (match.gameClock !== null && !match.horn) {
    match.gameClock = Math.max(0, match.gameClock - dt);
    if (match.gameClock === 0) match.horn = true;
  }

  const shotInFlight = ball.phase === 'shot' && ball.shot !== null && !ball.shot.resolved;
  if (match.horn) {
    if (!shotInFlight) endRegulation(world);
    return;
  }

  if (match.shotClock !== null && !shotInFlight) {
    match.shotClock = Math.max(0, match.shotClock - dt);
    if (match.shotClock === 0) {
      const culprit = world.players[ball.phase === 'held' ? ball.holder : ball.lastHolder];
      if (culprit && culprit.team === match.offense) {
        culprit.stats.turnovers++;
        emit(world, { type: 'turnover', player: culprit.id, team: culprit.team, reason: 'shotClock' });
      }
      setDead(world, 'shotClock', otherTeam(match.offense));
      return;
    }
  }

  if (match.needsClear && ball.phase === 'held') {
    const holder = world.players[ball.holder];
    if (holder && holder.team === match.offense && isClearSpot(world, holder)) {
      match.needsClear = false;
      emit(world, { type: 'clear', team: match.offense });
    }
  }
}

/** Beyond the arc, with a small tolerance so standing on the line counts. */
function isClearSpot(world: World, p: SimPlayer): boolean {
  return distanceBeyondArc(world.hoop, p.pos.x, p.pos.z) > -0.15;
}
