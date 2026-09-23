import { BODY } from '../data/tuning';
import type { Vec3 } from '../core/math';
import type { SimPlayer } from './types';

/** Player-relative geometry helpers (heading 0 faces +Z; right = forward × up). */

export function forwardX(p: SimPlayer): number {
  return Math.sin(p.facing);
}

export function forwardZ(p: SimPlayer): number {
  return Math.cos(p.facing);
}

export function rightX(p: SimPlayer): number {
  return -Math.cos(p.facing);
}

export function rightZ(p: SimPlayer): number {
  return Math.sin(p.facing);
}

/** Where a dribbling player carries the ball (sim-level; the view animates the bounce). */
export function ballCarryPoint(p: SimPlayer, out: Vec3): Vec3 {
  const side = BODY.ballSideOffset * p.hand;
  out.x = p.pos.x + forwardX(p) * BODY.ballForwardOffset + rightX(p) * side;
  out.z = p.pos.z + forwardZ(p) * BODY.ballForwardOffset + rightZ(p) * side;
  out.y = p.pos.y + BODY.ballCarryHeight * (p.height / 2);
  return out;
}

/** Height of the player's fingertips right now (standing reach + current jump). */
export function handHeight(p: SimPlayer): number {
  return p.reach + p.pos.y;
}

export function planarSpeed(p: SimPlayer): number {
  return Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z);
}

/** Unit direction from player to a point on the court plane (0,0 if coincident). */
export function dirTo(p: SimPlayer, x: number, z: number): { x: number; z: number; dist: number } {
  const dx = x - p.pos.x;
  const dz = z - p.pos.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < 1e-6) return { x: 0, z: 0, dist: 0 };
  return { x: dx / dist, z: dz / dist, dist };
}
