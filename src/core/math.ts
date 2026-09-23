/**
 * Allocation-free vector helpers used by the simulation and renderer bridge.
 * Vectors are plain objects so they serialize trivially (snapshots, replays, netcode).
 * Convention: meters, Y up, court plane is X (width) / Z (length).
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Vec2 {
  x: number;
  z: number;
}

export const TAU = Math.PI * 2;

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function vec2(x = 0, z = 0): Vec2 {
  return { x, z };
}

export function set3(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function copy3(out: Vec3, a: Vec3): Vec3 {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

export function copy2(out: Vec2, a: Vec2): Vec2 {
  out.x = a.x;
  out.z = a.z;
  return out;
}

export function length3(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function lengthXZ(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}

export function distXZ(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function distSqXZ(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function dist3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inverse lerp clamped to [0,1]. */
export function invLerp(a: number, b: number, v: number): number {
  if (a === b) return 0;
  return clamp01((v - a) / (b - a));
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

/** Wraps an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

/** Signed shortest difference from angle a to angle b. */
export function angleDiff(a: number, b: number): number {
  return wrapAngle(b - a);
}

/** Rotates angle `current` toward `target` by at most `maxDelta` radians. */
export function approachAngle(current: number, target: number, maxDelta: number): number {
  const d = angleDiff(current, target);
  if (Math.abs(d) <= maxDelta) return wrapAngle(target);
  return wrapAngle(current + Math.sign(d) * maxDelta);
}

/**
 * Heading convention: angle 0 faces +Z, positive angles rotate toward +X.
 * This matches Three.js rotation.y for a model authored facing +Z.
 */
export function headingOf(x: number, z: number): number {
  return Math.atan2(x, z);
}

export function headingX(angle: number): number {
  return Math.sin(angle);
}

export function headingZ(angle: number): number {
  return Math.cos(angle);
}

/** Exponential smoothing factor that is frame-rate independent. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function isFiniteVec3(v: Vec3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/** Squared distance from point p to segment ab on the XZ plane, and the segment parameter t. */
export function pointSegmentDistSqXZ(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { distSq: number; t: number } {
  const abx = bx - ax;
  const abz = bz - az;
  const lenSq = abx * abx + abz * abz;
  let t = lenSq > 1e-9 ? ((px - ax) * abx + (pz - az) * abz) / lenSq : 0;
  t = clamp01(t);
  const cx = ax + abx * t - px;
  const cz = az + abz * t - pz;
  return { distSq: cx * cx + cz * cz, t };
}
