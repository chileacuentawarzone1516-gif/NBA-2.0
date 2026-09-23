import { clamp, lerp } from '../../core/math';
import { ratingT } from '../../data/attributes';
import { DRIBBLE_MOVES } from '../../data/dribbleMoves';
import { BODY, DEFENSE, STAMINA } from '../../data/tuning';
import { resetAction } from '../playerFactory';
import { ballCarryPoint, forwardX, forwardZ, handHeight } from '../geometry';
import type { SimPlayer } from '../types';
import { emit, type World } from '../world';
import { startJumpPhysics } from './movement';
import { makeLoose } from './possession';
import { spendStamina } from './stamina';
import { vec3 } from '../../core/math';

/**
 * On-ball defense actions: steal reaches, jumps (contest/block/rebound) and block
 * resolution against shots in flight. Outcomes depend on geometry, timing, ratings,
 * stamina and the handler's current exposure — never on proximity alone.
 */

const carry = vec3();

export function startSteal(p: SimPlayer): boolean {
  if (p.airborne || p.action.kind !== 'none' || p.stealCooldown > 0) return false;
  const a = p.action;
  resetAction(a);
  a.kind = 'steal';
  a.duration = DEFENSE.stealDuration;
  p.stealCooldown = DEFENSE.stealCooldown;
  spendStamina(p, STAMINA.stealCost);
  return true;
}

export function updateSteal(world: World, p: SimPlayer): void {
  const a = p.action;
  if (!a.resolved && a.t >= DEFENSE.stealContactTime) {
    a.resolved = true;
    a.targetId = resolveStealContact(world, p) ? 1 : 0;
  }
  if (a.t >= a.duration) {
    const success = a.targetId === 1;
    resetAction(a);
    if (!success) {
      a.kind = 'reachRecover';
      a.duration = DEFENSE.reachRecovery;
    }
  }
}

/** Returns true when the reach knocked the ball loose. */
function resolveStealContact(world: World, p: SimPlayer): boolean {
  const { ball } = world;
  if (ball.phase !== 'held') return false;
  const handler = world.players[ball.holder];
  if (!handler || handler.team === p.team) return false;

  ballCarryPoint(handler, carry);
  const dx = carry.x - p.pos.x;
  const dz = carry.z - p.pos.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > DEFENSE.stealRange) {
    emit(world, { type: 'stealMiss', by: p.id });
    return false;
  }
  const facingCos = dist > 1e-4 ? (dx * forwardX(p) + dz * forwardZ(p)) / dist : 1;
  if (facingCos < Math.cos(DEFENSE.stealConeRadians)) {
    emit(world, { type: 'stealMiss', by: p.id });
    return false;
  }

  let chance = DEFENSE.stealBase + (p.attr.steal - handler.attr.ballHandle) * DEFENSE.stealRatingWeight;
  // Ball carried on the defender's side of the handler's body is exposed.
  const hx = handler.pos.x - p.pos.x;
  const hz = handler.pos.z - p.pos.z;
  if (dist < Math.sqrt(hx * hx + hz * hz)) chance += DEFENSE.exposedHandBonus;
  if (handler.action.kind === 'dribbleMove' && handler.action.moveId) {
    chance *= DRIBBLE_MOVES[handler.action.moveId].exposure;
  }
  if (handler.action.kind === 'shotGather' || handler.action.kind === 'pass') chance *= 1.25;
  chance *= p.mods.stealChance * lerp(0.85, 1.1, ratingT(p.attr.defensiveIQ));
  chance *= 1 - clamp((STAMINA.fatigueThreshold - p.stamina) / STAMINA.fatigueThreshold, 0, 1) * 0.25;
  chance = clamp(chance, 0.02, DEFENSE.maxStealChance);

  if (!world.rng.chance(chance)) {
    emit(world, { type: 'stealMiss', by: p.id });
    return false;
  }

  // Poke the ball loose toward the defender's side.
  if (handler.action.kind === 'shotGather' || handler.action.kind === 'pass' || handler.action.kind === 'dribbleMove') {
    resetAction(handler.action);
  }
  makeLoose(world, 'deflection', p);
  emit(world, { type: 'deflection', by: p.id });
  ball.pos.x = carry.x;
  ball.pos.y = carry.y;
  ball.pos.z = carry.z;
  const push = world.rng.range(2.2, 3.6);
  const len = dist > 1e-4 ? dist : 1;
  ball.vel.x = (-dx / len) * push * 0.5 + world.rng.range(-1, 1);
  ball.vel.z = (-dz / len) * push * 0.5 + world.rng.range(-1, 1);
  ball.vel.y = world.rng.range(0.5, 1.6);
  return true;
}

/** Jump for contest/block/rebound. */
export function startJump(world: World, p: SimPlayer, fraction = 1): boolean {
  if (p.airborne || (p.action.kind !== 'none' && p.action.kind !== 'reachRecover')) return false;
  const a = p.action;
  resetAction(a);
  a.kind = 'jump';
  a.duration = BODY.jumpDuration;
  startJumpPhysics(p, fraction, BODY.jumpDuration);
  // Jumping converts some run-up into the jump.
  p.vel.x *= 0.65;
  p.vel.z *= 0.65;
  spendStamina(p, STAMINA.jumpCost);
  emit(world, { type: 'jump', player: p.id });
  return true;
}

export function updateJump(p: SimPlayer): void {
  if (!p.airborne && p.action.t > 0.05) resetAction(p.action);
}

/**
 * Checks defenders against a rising shot. Each defender rolls once per shot while his
 * hand can physically reach the ball.
 */
export function checkBlocks(world: World): void {
  const { ball } = world;
  const shot = ball.shot;
  if (!shot || shot.blocked || shot.t > DEFENSE.blockWindow || ball.vel.y <= 0) return;
  const shooter = world.players[shot.shooter];
  if (!shooter) return;
  for (const d of world.players) {
    if (d.team === shot.team) continue;
    const bit = 1 << d.id;
    if (shot.blockRolled & bit) continue;
    const dx = ball.pos.x - d.pos.x;
    const dz = ball.pos.z - d.pos.z;
    const horizontal = Math.sqrt(dx * dx + dz * dz);
    if (horizontal > DEFENSE.blockRangeHorizontal) continue;
    if (handHeight(d) + 0.12 < ball.pos.y) continue;
    shot.blockRolled |= bit;

    const ratingEdge = d.attr.block - (shot.type === 'dunk' ? shooter.attr.dunk : shooter.attr.finishing * 0.5 + 40);
    const jumpShot = shot.type === 'jumper' || shot.type === 'pullUp' || shot.type === 'fade' || shot.type === 'stepback';
    if (!d.airborne && jumpShot) continue;
    let chance = DEFENSE.blockBase + ratingEdge * DEFENSE.blockRatingWeight;
    chance += (handHeight(d) - ball.pos.y) * 0.3;
    if (!d.airborne) chance *= DEFENSE.standingBlockFactor;
    if (jumpShot) chance *= 0.7;
    if (shot.type === 'dunk') chance *= 0.7;
    chance *= d.mods.blockChance * (1 - (horizontal / DEFENSE.blockRangeHorizontal) * 0.5);
    chance = clamp(chance, 0, 0.6);
    if (!world.rng.chance(chance)) continue;

    shot.blocked = true;
    shot.resolved = true;
    d.stats.blocks++;
    makeLoose(world, 'block', d);
    const swat = world.rng.range(3.5, 6);
    const len = horizontal > 1e-3 ? horizontal : 1;
    ball.vel.x = (dx / len) * swat + world.rng.range(-1.5, 1.5);
    ball.vel.z = (dz / len) * swat + world.rng.range(-1.5, 1.5);
    ball.vel.y = world.rng.range(-1, 2.5);
    emit(world, { type: 'block', by: d.id, shooter: shooter.id });
    return;
  }
}
