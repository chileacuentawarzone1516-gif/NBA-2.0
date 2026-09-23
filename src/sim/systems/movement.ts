import { approachAngle, clamp, headingOf, lerp } from '../../core/math';
import { ratingT } from '../../data/attributes';
import { DRIBBLE_MOVES } from '../../data/dribbleMoves';
import { MOVEMENT, STAMINA } from '../../data/tuning';
import { Button, isDown, type PlayerInput } from '../input';
import { dirTo } from '../geometry';
import type { SimPlayer } from '../types';
import type { World } from '../world';

/**
 * Locomotion: converts intent into acceleration-limited velocity, handles facing,
 * vertical jump integration, player-vs-player contact and court bounds.
 */

export function speedFactor(p: SimPlayer): number {
  const r = MOVEMENT.speedRatingRange;
  return lerp(r[0], r[1], ratingT(p.attr.speed));
}

export function fatigueFactor(p: SimPlayer): number {
  const t = clamp((STAMINA.fatigueThreshold - p.stamina) / STAMINA.fatigueThreshold, 0, 1);
  return 1 - t * STAMINA.maxSpeedPenalty;
}

export function maxSpeed(p: SimPlayer, sprint: boolean, hasBall: boolean): number {
  let speed = sprint ? MOVEMENT.sprintSpeed : MOVEMENT.jogSpeed;
  speed *= speedFactor(p) * fatigueFactor(p);
  if (hasBall) speed *= MOVEMENT.withBallMultiplier;
  if (!sprint && p.inStance) speed *= MOVEMENT.stanceSpeedMultiplier;
  if (p.boostTime > 0) speed *= p.boostMultiplier;
  return speed;
}

function accelerationOf(p: SimPlayer): number {
  const r = MOVEMENT.accelerationRatingRange;
  return MOVEMENT.acceleration * lerp(r[0], r[1], ratingT(p.attr.acceleration));
}

let desiredX = 0;
let desiredZ = 0;

/** Computes the desired planar velocity into module scratch (desiredX/desiredZ). */
function computeDesired(world: World, p: SimPlayer, input: PlayerInput, hasBall: boolean): void {
  const a = p.action;
  let mx = input.moveX;
  let mz = input.moveZ;
  let mag = Math.sqrt(mx * mx + mz * mz);
  if (mag < MOVEMENT.inputDeadZone) {
    mx = 0;
    mz = 0;
    mag = 0;
  } else if (mag > 1) {
    mx /= mag;
    mz /= mag;
    mag = 1;
  }

  // Pass-receive assist: a receiver without stick input steps toward the ball.
  const { ball } = world;
  if (mag < 0.3 && ball.phase === 'pass' && ball.pass?.target === p.id) {
    const toBall = dirTo(p, ball.pos.x, ball.pos.z);
    if (toBall.dist > 0.6) {
      mx = toBall.x * 0.8;
      mz = toBall.z * 0.8;
      mag = 0.8;
    }
  }

  const sprint = isDown(input, Button.Sprint) && !p.exhausted && p.stamina > 1;
  p.sprinting = sprint && mag > 0.5 && (a.kind === 'none' || a.kind === 'dribbleMove');
  let speed = maxSpeed(p, p.sprinting, hasBall) * mag;

  switch (a.kind) {
    case 'dribbleMove': {
      const move = a.moveId ? DRIBBLE_MOVES[a.moveId] : null;
      const displaceTime = a.duration * 0.6;
      if (move && a.t < displaceTime) {
        const quick = lerp(0.85, 1.12, ratingT(p.attr.acceleration)) * lerp(0.9, 1.08, ratingT(p.attr.ballHandle));
        desiredX = ((a.sideX * move.lateral + a.dirX * move.forward) / displaceTime) * quick;
        desiredZ = ((a.sideZ * move.lateral + a.dirZ * move.forward) / displaceTime) * quick;
        return;
      }
      break;
    }
    case 'shotGather':
    case 'shotFollow':
    case 'pumpFake': {
      if (a.shotType === 'fade') {
        const away = dirTo(p, world.hoop.x, world.hoop.z);
        desiredX = -away.x * 1.3;
        desiredZ = -away.z * 1.3;
      } else {
        desiredX = 0;
        desiredZ = 0;
      }
      return;
    }
    case 'layup':
    case 'dunk': {
      if (!a.released) {
        // For finishes, dirX/dirZ hold the world-space finish spot next to the rim.
        const target = dirTo(p, a.dirX, a.dirZ);
        const remaining = Math.max(a.releaseTime - a.t, 0.1);
        const v = Math.min(target.dist / remaining, 7.5);
        desiredX = target.x * v;
        desiredZ = target.z * v;
      } else {
        desiredX = p.vel.x * 0.9;
        desiredZ = p.vel.z * 0.9;
      }
      return;
    }
    case 'pass':
      speed *= 0.6;
      break;
    case 'steal':
      speed *= 0.5;
      break;
    case 'stumble':
      speed = Math.min(speed, maxSpeed(p, false, hasBall) * MOVEMENT.stumbleSpeedMultiplier);
      break;
    case 'reachRecover':
      speed *= MOVEMENT.reachRecoverySpeedMultiplier;
      break;
    default:
      break;
  }
  desiredX = mx * (mag > 0 ? speed / mag : 0);
  desiredZ = mz * (mag > 0 ? speed / mag : 0);
}

export function updatePlayerMovement(world: World, p: SimPlayer, input: PlayerInput, dt: number): void {
  const hasBall = world.ball.phase === 'held' && world.ball.holder === p.id;
  if (p.boostTime > 0) p.boostTime = Math.max(0, p.boostTime - dt);

  if (p.airborne) {
    // Committed jump: no air control, momentum carries.
    p.pos.x += p.vel.x * dt;
    p.pos.z += p.vel.z * dt;
    p.pos.y += p.vy * dt - 0.5 * p.jumpG * dt * dt;
    p.vy -= p.jumpG * dt;
    if (p.pos.y <= 0) {
      p.pos.y = 0;
      p.vy = 0;
      p.airborne = false;
      p.vel.x *= 0.4;
      p.vel.z *= 0.4;
    }
    // Layups/dunks keep steering toward the rim while airborne.
    if (p.action.kind === 'layup' || p.action.kind === 'dunk') {
      computeDesired(world, p, input, hasBall);
      p.vel.x = desiredX;
      p.vel.z = desiredZ;
    }
    updateFacing(world, p, hasBall, dt);
    return;
  }

  computeDesired(world, p, input, hasBall);
  const dvx = desiredX - p.vel.x;
  const dvz = desiredZ - p.vel.z;
  const dv = Math.sqrt(dvx * dvx + dvz * dvz);
  if (dv > 1e-6) {
    const currentSq = p.vel.x * p.vel.x + p.vel.z * p.vel.z;
    const desiredSq = desiredX * desiredX + desiredZ * desiredZ;
    const forced = p.action.kind === 'dribbleMove' || p.action.kind === 'layup' || p.action.kind === 'dunk';
    const rate = forced ? 60 : desiredSq < currentSq ? MOVEMENT.deceleration : accelerationOf(p);
    const step = Math.min(dv, rate * dt);
    p.vel.x += (dvx / dv) * step;
    p.vel.z += (dvz / dv) * step;
  }
  p.pos.x += p.vel.x * dt;
  p.pos.z += p.vel.z * dt;
  updateFacing(world, p, hasBall, dt);
}

function updateFacing(world: World, p: SimPlayer, hasBall: boolean, dt: number): void {
  const a = p.action.kind;
  const speedSq = p.vel.x * p.vel.x + p.vel.z * p.vel.z;
  let target = p.facing;
  const { hoop, ball } = world;

  if (a === 'shotGather' || a === 'shotFollow' || a === 'layup' || a === 'dunk' || a === 'pumpFake') {
    target = headingOf(hoop.x - p.pos.x, hoop.z - p.pos.z);
  } else if (a === 'dribbleMove') {
    return; // Moves keep the facing they started with.
  } else if (p.inStance) {
    target = headingOf(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
  } else if (speedSq > 0.36) {
    target = headingOf(p.vel.x, p.vel.z);
  } else if (hasBall) {
    target = headingOf(hoop.x - p.pos.x, hoop.z - p.pos.z);
  } else {
    target = headingOf(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
  }
  const rate = hasBall ? MOVEMENT.turnRateWithBall : MOVEMENT.turnRate;
  p.facing = approachAngle(p.facing, target, rate * dt);
}

/** Resolves overlaps between players; stronger/set players move less. */
export function resolvePlayerContacts(world: World): void {
  const players = world.players;
  const minDist = MOVEMENT.playerRadius * 2;
  for (let i = 0; i < players.length; i++) {
    const a = players[i]!;
    for (let j = i + 1; j < players.length; j++) {
      const b = players[j]!;
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.z - a.pos.z;
      const distSq = dx * dx + dz * dz;
      if (distSq >= minDist * minDist) continue;
      const dist = Math.sqrt(distSq) || 1e-4;
      const nx = distSq > 1e-8 ? dx / dist : 1;
      const nz = distSq > 1e-8 ? dz / dist : 0;
      const overlap = minDist - dist;
      const massA = contactMass(a);
      const massB = contactMass(b);
      const shareA = massB / (massA + massB);
      const shareB = 1 - shareA;
      a.pos.x -= nx * overlap * shareA;
      a.pos.z -= nz * overlap * shareA;
      b.pos.x += nx * overlap * shareB;
      b.pos.z += nz * overlap * shareB;
      // Remove closing velocity so bodies do not tunnel; the lighter body loses more.
      const rvx = b.vel.x - a.vel.x;
      const rvz = b.vel.z - a.vel.z;
      const closing = rvx * nx + rvz * nz;
      if (closing < 0) {
        a.vel.x += nx * closing * shareA;
        a.vel.z += nz * closing * shareA;
        b.vel.x -= nx * closing * shareB;
        b.vel.z -= nz * closing * shareB;
      }
    }
  }
}

function contactMass(p: SimPlayer): number {
  let mass = 0.6 + ratingT(p.attr.strength) * 0.8 + p.build * 0.4;
  // A set defender in stance holds his ground.
  if (p.inStance) mass *= 1 + MOVEMENT.strengthPushBias;
  if (p.airborne) mass *= 0.7;
  return mass;
}

export function clampToBounds(world: World, p: SimPlayer): void {
  const b = world.bounds;
  const m = MOVEMENT.boundsMargin;
  if (p.pos.x < b.minX + m) {
    p.pos.x = b.minX + m;
    if (p.vel.x < 0) p.vel.x = 0;
  } else if (p.pos.x > b.maxX - m) {
    p.pos.x = b.maxX - m;
    if (p.vel.x > 0) p.vel.x = 0;
  }
  if (p.pos.z < b.minZ + m) {
    p.pos.z = b.minZ + m;
    if (p.vel.z < 0) p.vel.z = 0;
  } else if (p.pos.z > b.maxZ - m) {
    p.pos.z = b.maxZ - m;
    if (p.vel.z > 0) p.vel.z = 0;
  }
}

/** Starts a vertical jump. `fraction` scales the player's max vertical. */
export function startJumpPhysics(p: SimPlayer, fraction: number, duration: number): void {
  const h = p.jumpHeight * fraction;
  p.airborne = true;
  p.vy = (4 * h) / duration;
  p.jumpG = (8 * h) / (duration * duration);
  p.pos.y = Math.max(p.pos.y, 1e-4);
}
