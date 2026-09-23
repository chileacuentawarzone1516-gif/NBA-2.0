import { clamp, lerp, pointSegmentDistSqXZ, vec3 } from '../../core/math';
import { ratingT } from '../../data/attributes';
import { PASSING } from '../../data/tuning';
import { resetAction } from '../playerFactory';
import { ballCarryPoint, forwardX, forwardZ, handHeight } from '../geometry';
import type { PassInfo, SimPlayer } from '../types';
import { emit, type World } from '../world';
import { solvePassVelocity } from './ballPhysics';
import { giveBall, makeLoose } from './possession';

/**
 * Passing: target selection (explicit id or stick-directed cone), pass type choice
 * (chest / bounce / lob) from lane traffic, lead passes, catches and interceptions.
 */

const from = vec3();
const target = vec3();

/** Chooses the receiver for a stick-directed pass (or the best option when neutral). */
export function selectPassTarget(world: World, passer: SimPlayer, aimX: number, aimZ: number): SimPlayer | null {
  let aim = Math.sqrt(aimX * aimX + aimZ * aimZ);
  let ax = aimX;
  let az = aimZ;
  if (aim < 0.3) {
    ax = forwardX(passer);
    az = forwardZ(passer);
    aim = 1;
  }
  ax /= aim;
  az /= aim;
  let best: SimPlayer | null = null;
  let bestScore = -Infinity;
  for (const mate of world.players) {
    if (mate.team !== passer.team || mate.id === passer.id) continue;
    const dx = mate.pos.x - passer.pos.x;
    const dz = mate.pos.z - passer.pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.5 || dist > PASSING.maxPassDistance) continue;
    const cos = (dx * ax + dz * az) / dist;
    const angle = Math.acos(clamp(cos, -1, 1));
    // Strongly prefer the aimed direction, mildly prefer shorter passes and callers.
    let score = -angle * 3 - dist * 0.05;
    if (angle > PASSING.aimConeRadians) score -= 5;
    if (mate.callForBall > 0) score += 0.6;
    if (score > bestScore) {
      bestScore = score;
      best = mate;
    }
  }
  return best;
}

export function startPass(passer: SimPlayer, receiver: SimPlayer): boolean {
  if (passer.airborne || passer.action.kind !== 'none') return false;
  const a = passer.action;
  resetAction(a);
  a.kind = 'pass';
  a.duration = PASSING.passActionTime;
  a.targetId = receiver.id;
  return true;
}

export function updatePassAction(world: World, passer: SimPlayer): void {
  const a = passer.action;
  if (!a.resolved && a.t >= a.duration * 0.45) {
    a.resolved = true;
    const receiver = world.players[a.targetId];
    const { ball } = world;
    if (receiver && ball.phase === 'held' && ball.holder === passer.id) releasePass(world, passer, receiver);
  }
  if (a.t >= a.duration) resetAction(a);
}

function laneTraffic(world: World, passer: SimPlayer, tx: number, tz: number): number {
  let traffic = 0;
  for (const d of world.players) {
    if (d.team === passer.team) continue;
    const { distSq, t } = pointSegmentDistSqXZ(d.pos.x, d.pos.z, passer.pos.x, passer.pos.z, tx, tz);
    if (t > 0.1 && t < 0.95 && distSq < 1.1 * 1.1) traffic = Math.max(traffic, 1 - Math.sqrt(distSq) / 1.1);
  }
  return traffic;
}

function releasePass(world: World, passer: SimPlayer, receiver: SimPlayer): void {
  const { ball } = world;
  ballCarryPoint(passer, from);
  from.y = Math.max(from.y, 1.15);

  const speedMod = passer.mods.passSpeed * lerp(0.9, 1.1, ratingT(passer.attr.passing));
  // Lead the receiver: iterate once on flight time.
  let flight = 0;
  for (let i = 0; i < 2; i++) {
    const lx = receiver.pos.x + receiver.vel.x * flight;
    const lz = receiver.pos.z + receiver.vel.z * flight;
    const dist = Math.hypot(lx - from.x, lz - from.z);
    flight = dist / (PASSING.chestSpeed * speedMod);
  }
  target.x = clamp(receiver.pos.x + receiver.vel.x * flight, world.bounds.minX + 0.4, world.bounds.maxX - 0.4);
  target.z = clamp(receiver.pos.z + receiver.vel.z * flight, world.bounds.minZ + 0.4, world.bounds.maxZ - 0.4);
  target.y = 1.2;
  const dist = Math.hypot(target.x - from.x, target.z - from.z);
  const traffic = laneTraffic(world, passer, target.x, target.z);

  let type: PassInfo['type'] = 'chest';
  if (traffic > 0.35 && dist > 6) type = 'lob';
  else if (traffic > 0.2 && dist < 8) type = 'bounce';

  if (type === 'lob') {
    flight = dist / (PASSING.lobSpeed * speedMod);
    target.y = 1.7;
  } else if (type === 'bounce') {
    flight = dist / (PASSING.bounceSpeed * speedMod);
  } else {
    flight = dist / (PASSING.chestSpeed * speedMod);
  }
  flight = Math.max(flight, 0.18);

  ball.phase = 'pass';
  ball.holder = -1;
  ball.lastHolder = passer.id;
  ball.lastTouch = passer.id;
  ball.lastTouchTeam = passer.team;
  ball.phaseTime = 0;
  ball.pos.x = from.x;
  ball.pos.y = from.y;
  ball.pos.z = from.z;
  if (type === 'bounce') {
    // Aim at a floor point 60% of the way; floor restitution carries it up to the receiver.
    const bx = from.x + (target.x - from.x) * 0.6;
    const bz = from.z + (target.z - from.z) * 0.6;
    const t1 = flight * 0.55;
    ball.vel.x = (bx - from.x) / t1;
    ball.vel.z = (bz - from.z) / t1;
    ball.vel.y = (0.12 - from.y + 0.5 * 9.81 * t1 * t1) / t1;
  } else {
    solvePassVelocity(from, target, flight, ball.vel);
  }
  ball.pass = { passer: passer.id, target: receiver.id, type, t: 0, duration: flight, interceptRolled: 0 };
  emit(world, { type: 'pass', from: passer.id, to: receiver.id, passType: type });
}

/** Per-tick pass flight logic: interceptions and catches. Physics is integrated by the caller. */
export function updatePassFlight(world: World, dt: number): void {
  const { ball } = world;
  const pass = ball.pass;
  if (!pass) return;
  pass.t += dt;
  const passer = world.players[pass.passer];
  const receiver = world.players[pass.target];
  if (!passer || !receiver) {
    makeLoose(world, 'fumble', null);
    return;
  }

  for (const d of world.players) {
    if (d.team === passer.team) continue;
    const bit = 1 << d.id;
    if (pass.interceptRolled & bit) continue;
    const dx = ball.pos.x - d.pos.x;
    const dz = ball.pos.z - d.pos.z;
    const reachRadius = PASSING.interceptRadius + 0.25 * ratingT(d.attr.steal);
    if (dx * dx + dz * dz > reachRadius * reachRadius) continue;
    if (ball.pos.y > handHeight(d) + 0.1 || ball.pos.y < 0.3) continue;
    pass.interceptRolled |= bit;
    let chance = PASSING.interceptBase + PASSING.interceptRatingWeight * ratingT(d.attr.steal);
    chance *= d.mods.stealChance / passer.mods.passSpeed;
    chance *= lerp(0.85, 1.15, ratingT(d.attr.defensiveIQ));
    if (d.action.kind === 'stumble') chance *= 0.2;
    if (!world.rng.chance(clamp(chance, 0, 0.8))) continue;
    passer.stats.turnovers++;
    d.stats.steals++;
    emit(world, { type: 'turnover', player: passer.id, team: passer.team, reason: 'interception' });
    emit(world, { type: 'steal', by: d.id, from: passer.id, kind: 'interception' });
    if (world.rng.chance(0.6 + 0.3 * ratingT(d.attr.steal))) {
      giveBall(world, d, 'interception');
    } else {
      makeLoose(world, 'fumble', d);
      ball.vel.x *= -0.3;
      ball.vel.z *= -0.3;
      ball.vel.y = 1.5;
    }
    return;
  }

  // Catch by the intended receiver.
  const cx = ball.pos.x - receiver.pos.x;
  const cz = ball.pos.z - receiver.pos.z;
  const lowCatch = PASSING.catchHeightRange[0];
  const highCatch = Math.max(PASSING.catchHeightRange[1], handHeight(receiver));
  if (cx * cx + cz * cz <= PASSING.catchRadius * PASSING.catchRadius && ball.pos.y >= lowCatch && ball.pos.y <= highCatch) {
    receiver.sinceCatch = 0;
    receiver.lastPasser = passer.id;
    receiver.callForBall = 0;
    giveBall(world, receiver, 'catch');
    return;
  }
  if (pass.t > pass.duration + 0.45) makeLoose(world, 'fumble', null);
}
