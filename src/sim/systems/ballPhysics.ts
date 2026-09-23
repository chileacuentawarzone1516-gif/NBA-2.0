import { COURT, backboardFaceZ, type Hoop } from '../../data/court';
import { BALL, GRAVITY } from '../../data/tuning';
import type { Vec3 } from '../../core/math';

/**
 * Pure ball physics: gravity (exact integration), rim torus, backboard box and floor.
 * Used both for the live ball and for forward predictions (shot verification, rebound
 * landing estimates), so it must stay side-effect free apart from the passed-in body.
 */

export interface BallBody {
  pos: Vec3;
  vel: Vec3;
}

export interface BallContacts {
  rim: number;
  backboard: number;
  floor: number;
  /** Ball center crossed the rim plane downward inside the rim this step. */
  scored: boolean;
}

export function resetContacts(c: BallContacts): BallContacts {
  c.rim = 0;
  c.backboard = 0;
  c.floor = 0;
  c.scored = false;
  return c;
}

export function createContacts(): BallContacts {
  return { rim: 0, backboard: 0, floor: 0, scored: false };
}

export interface BallPhysicsOptions {
  /** Disable rim/backboard contact (net guidance after a make). */
  hoopCollision: boolean;
  /** Pull the ball down through the net. */
  netGuide: boolean;
}

const MAX_SUBSTEP_DISTANCE = 0.035;
const MAX_SUBSTEPS = 10;
const RIM_CONTACT = BALL.radius + COURT.rimTubeRadius;

export function integrateBall(
  body: BallBody,
  dt: number,
  hoop: Hoop,
  contacts: BallContacts,
  options: BallPhysicsOptions,
): void {
  const speed = Math.sqrt(body.vel.x * body.vel.x + body.vel.y * body.vel.y + body.vel.z * body.vel.z);
  const substeps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil((speed * dt) / MAX_SUBSTEP_DISTANCE)));
  const h = dt / substeps;
  for (let i = 0; i < substeps; i++) substep(body, h, hoop, contacts, options);
}

function substep(body: BallBody, h: number, hoop: Hoop, contacts: BallContacts, options: BallPhysicsOptions): void {
  const p = body.pos;
  const v = body.vel;
  const prevY = p.y;

  if (options.netGuide) {
    // Pull toward the rim axis and damp: the net swallows the ball.
    const damp = Math.pow(BALL.netDrag, h);
    v.x = v.x * damp + (hoop.x - p.x) * 18 * h;
    v.z = v.z * damp + (hoop.z - p.z) * 18 * h;
    if (v.y < -3.2) v.y = -3.2;
  }

  // Exact integration for constant gravity (keeps analytic shot solutions accurate).
  p.x += v.x * h;
  p.z += v.z * h;
  p.y += v.y * h - 0.5 * GRAVITY * h * h;
  v.y -= GRAVITY * h;

  if (options.hoopCollision) {
    if (
      prevY > hoop.y &&
      p.y <= hoop.y &&
      v.y < 0 &&
      (p.x - hoop.x) * (p.x - hoop.x) + (p.z - hoop.z) * (p.z - hoop.z) < (COURT.rimRadius - 0.02) * (COURT.rimRadius - 0.02)
    ) {
      contacts.scored = true;
    }
    collideRim(body, hoop, contacts);
    collideBackboard(body, hoop, contacts);
  }
  collideFloor(body, h, contacts);
}

function collideRim(body: BallBody, hoop: Hoop, contacts: BallContacts): void {
  const p = body.pos;
  const dy = p.y - hoop.y;
  if (dy > RIM_CONTACT || dy < -RIM_CONTACT) return;
  const qx = p.x - hoop.x;
  const qz = p.z - hoop.z;
  const qLen = Math.sqrt(qx * qx + qz * qz);
  if (qLen < 1e-6) return;
  // Closest point on the rim circle.
  const kx = hoop.x + (qx / qLen) * COURT.rimRadius;
  const kz = hoop.z + (qz / qLen) * COURT.rimRadius;
  const dx = p.x - kx;
  const dz = p.z - kz;
  const distSq = dx * dx + dy * dy + dz * dz;
  if (distSq >= RIM_CONTACT * RIM_CONTACT) return;
  const dist = Math.sqrt(distSq) || 1e-6;
  const nx = dx / dist;
  const ny = dy / dist;
  const nz = dz / dist;
  p.x = kx + nx * RIM_CONTACT;
  p.y = hoop.y + ny * RIM_CONTACT;
  p.z = kz + nz * RIM_CONTACT;
  reflect(body.vel, nx, ny, nz, BALL.rimRestitution, 0.9, contacts, 'rim');
}

function collideBackboard(body: BallBody, hoop: Hoop, contacts: BallContacts): void {
  const p = body.pos;
  const face = backboardFaceZ(hoop);
  const back = face + hoop.dir * COURT.backboardThickness;
  const minZ = Math.min(face, back);
  const maxZ = Math.max(face, back);
  const halfW = COURT.backboardWidth / 2;
  const minY = COURT.backboardBottom;
  const maxY = COURT.backboardBottom + COURT.backboardHeight;
  // Closest point on the board box.
  const cx = Math.max(hoop.x - halfW, Math.min(p.x, hoop.x + halfW));
  const cy = Math.max(minY, Math.min(p.y, maxY));
  const cz = Math.max(minZ, Math.min(p.z, maxZ));
  const dx = p.x - cx;
  const dy = p.y - cy;
  const dz = p.z - cz;
  const distSq = dx * dx + dy * dy + dz * dz;
  if (distSq >= BALL.radius * BALL.radius) return;
  let nx: number;
  let ny: number;
  let nz: number;
  let dist = Math.sqrt(distSq);
  if (dist < 1e-6) {
    // Center inside the board: push out through the court-facing side.
    nx = 0;
    ny = 0;
    nz = -hoop.dir;
    dist = 0;
  } else {
    nx = dx / dist;
    ny = dy / dist;
    nz = dz / dist;
  }
  const push = BALL.radius - dist;
  p.x += nx * push;
  p.y += ny * push;
  p.z += nz * push;
  reflect(body.vel, nx, ny, nz, BALL.backboardRestitution, 0.92, contacts, 'backboard');
}

function collideFloor(body: BallBody, h: number, contacts: BallContacts): void {
  const p = body.pos;
  const v = body.vel;
  if (p.y > BALL.radius) return;
  p.y = BALL.radius;
  if (v.y < -BALL.restVerticalSpeed) {
    contacts.floor = Math.max(contacts.floor, -v.y);
    v.y = -v.y * BALL.floorRestitution;
    v.x *= BALL.floorFriction;
    v.z *= BALL.floorFriction;
  } else {
    // Rolling.
    v.y = 0;
    const hs = Math.sqrt(v.x * v.x + v.z * v.z);
    if (hs > 1e-4) {
      const next = Math.max(0, hs - BALL.rollingFriction * h);
      v.x *= next / hs;
      v.z *= next / hs;
    } else {
      v.x = 0;
      v.z = 0;
    }
  }
}

function reflect(
  v: Vec3,
  nx: number,
  ny: number,
  nz: number,
  restitution: number,
  tangentKeep: number,
  contacts: BallContacts,
  kind: 'rim' | 'backboard',
): void {
  const vn = v.x * nx + v.y * ny + v.z * nz;
  if (vn >= 0) return;
  const tx = v.x - vn * nx;
  const ty = v.y - vn * ny;
  const tz = v.z - vn * nz;
  v.x = tx * tangentKeep - vn * restitution * nx;
  v.y = ty * tangentKeep - vn * restitution * ny;
  v.z = tz * tangentKeep - vn * restitution * nz;
  contacts[kind] = Math.max(contacts[kind], -vn);
}

/**
 * Analytic launch velocity so the ball center passes through `target` while descending,
 * peaking `arc` meters above the higher of the two points.
 */
export function solveLaunchVelocity(from: Vec3, target: Vec3, arc: number, out: Vec3): number {
  const apex = Math.max(from.y, target.y) + Math.max(0.05, arc);
  const up = apex - from.y;
  const down = apex - target.y;
  const vy = Math.sqrt(2 * GRAVITY * up);
  const tUp = vy / GRAVITY;
  const tDown = Math.sqrt((2 * down) / GRAVITY);
  const flight = tUp + tDown;
  out.x = (target.x - from.x) / flight;
  out.z = (target.z - from.z) / flight;
  out.y = vy;
  return flight;
}

/** Straight-line style pass: reaches `target` after `flight` seconds. */
export function solvePassVelocity(from: Vec3, target: Vec3, flight: number, out: Vec3): void {
  out.x = (target.x - from.x) / flight;
  out.z = (target.z - from.z) / flight;
  out.y = (target.y - from.y + 0.5 * GRAVITY * flight * flight) / flight;
}
