import { copy3 } from '../../core/math';
import { resetAction } from '../playerFactory';
import { ballCarryPoint } from '../geometry';
import type { LooseReason, SimPlayer, TeamIndex } from '../types';
import { emit, type World } from '../world';

/**
 * Possession is owned exclusively by this module: every change of ball ownership
 * (and the resulting change of offense) goes through these functions, so there is a
 * single source of truth for who has the ball and why.
 */

export type GainReason = 'check' | 'catch' | 'rebound' | 'loose' | 'interception' | 'practice';

export function giveBall(world: World, player: SimPlayer, reason: GainReason): void {
  const { ball, match } = world;
  const previousPhase = ball.phase;
  const looseReason = ball.looseReason;
  const shot = ball.shot;
  const deflectedBy = ball.lastTouch;

  ball.phase = 'held';
  ball.holder = player.id;
  ball.pass = null;
  ball.shot = null;
  ball.looseReason = 'none';
  ball.phaseTime = 0;
  ball.netTime = 0;
  ball.restTime = 0;
  ball.vel.x = 0;
  ball.vel.y = 0;
  ball.vel.z = 0;
  ball.lastTouch = player.id;
  ball.lastTouchTeam = player.team;
  ballCarryPoint(player, ball.pos);
  copy3(ball.prevPos, ball.pos);

  if (reason === 'check' || reason === 'practice') {
    ball.lastHolder = player.id;
    return;
  }

  const changedTeam = player.team !== match.offense;
  if (reason === 'rebound' && shot) {
    const offensive = player.team === shot.team;
    if (offensive) player.stats.oreb++;
    else player.stats.dreb++;
    emit(world, { type: 'rebound', player: player.id, offensive });
  } else if (previousPhase === 'loose') {
    if (looseReason === 'deflection' && changedTeam && deflectedBy >= 0) {
      const stealer = world.players[deflectedBy];
      const victim = world.players[ball.lastHolder];
      if (stealer && stealer.team === player.team) stealer.stats.steals++;
      if (victim) {
        victim.stats.turnovers++;
        emit(world, { type: 'turnover', player: victim.id, team: victim.team, reason: 'steal' });
      }
      emit(world, { type: 'steal', by: deflectedBy, from: ball.lastHolder, kind: 'poke' });
    } else if (looseReason === 'block' || looseReason === 'rebound') {
      // A recovered block counts as a rebound for the recovering team.
      const offensive = player.team === match.offense;
      if (offensive) player.stats.oreb++;
      else player.stats.dreb++;
      emit(world, { type: 'rebound', player: player.id, offensive });
    } else {
      emit(world, { type: 'looseBall', player: player.id });
    }
  } else if (reason === 'catch') {
    emit(world, { type: 'catch', player: player.id });
  }

  ball.lastHolder = player.id;
  if (changedTeam) setOffense(world, player.team, true);
  else if (reason === 'rebound' && world.mode.shotClock !== null) match.shotClock = world.mode.shotClock;
}

/** Switches the offensive team during live play (turnover or defensive rebound). */
export function setOffense(world: World, team: TeamIndex, live: boolean): void {
  const { match, mode } = world;
  match.offense = team;
  match.shotClock = mode.shotClock;
  match.needsClear = live && mode.clearRule;
  emit(world, { type: 'possession', team });
}

export function makeLoose(world: World, reason: LooseReason, touchedBy: SimPlayer | null): void {
  const { ball } = world;
  if (ball.phase === 'held' && ball.holder >= 0) ball.lastHolder = ball.holder;
  ball.phase = 'loose';
  ball.holder = -1;
  ball.pass = null;
  ball.looseReason = reason;
  ball.phaseTime = 0;
  ball.restTime = 0;
  if (touchedBy) {
    ball.lastTouch = touchedBy.id;
    ball.lastTouchTeam = touchedBy.team;
  }
}

export function makeDead(world: World): void {
  const { ball } = world;
  if (ball.holder >= 0) {
    const holder = world.players[ball.holder];
    if (holder && (holder.action.kind === 'shotGather' || holder.action.kind === 'pass')) resetAction(holder.action);
  }
  ball.phase = 'dead';
  ball.holder = -1;
  ball.pass = null;
  ball.phaseTime = 0;
}

export function holderOf(world: World): SimPlayer | null {
  const { ball } = world;
  if (ball.phase !== 'held' || ball.holder < 0) return null;
  return world.players[ball.holder] ?? null;
}
