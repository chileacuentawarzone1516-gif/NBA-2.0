import { clamp, pointSegmentDistSqXZ } from '../core/math';
import { distanceBeyondArc, fromHoopLocal, toHoopLocal } from '../data/court';
import { STAMINA, type TimingGrade } from '../data/tuning';
import { computeContest, computeShotChance, chooseShotType, shotPoints, shotRating } from '../sim/systems/shooting';
import { dirTo, planarSpeed } from '../sim/geometry';
import type { SimPlayer } from '../sim/types';
import type { World } from '../sim/world';

/**
 * Read-only court analysis used by AI decisions. Everything here queries the same
 * gameplay formulas the simulation uses, so the AI "knows" what a shot is worth.
 */

export interface ShotEstimate {
  pct: number;
  points: number;
  ev: number;
  beyondArc: boolean;
}

/**
 * Expected value of shooting right now, assuming the AI's typical release quality and
 * projecting defenders' closeouts over `anticipation` seconds (the time to release).
 */
export function estimateShot(world: World, p: SimPlayer, anticipation = 0, assumedTiming: TimingGrade = 'good'): ShotEstimate {
  const type = chooseShotType(world, p);
  const beyond = distanceBeyondArc(world.hoop, p.pos.x, p.pos.z);
  const beyondArc = beyond > 0;
  const distance = Math.hypot(world.hoop.x - p.pos.x, world.hoop.z - p.pos.z);
  const pct = computeShotChance({
    type,
    rating: shotRating(p, type, beyondArc),
    distance,
    beyondArc,
    deepMeters: Math.max(0, beyond),
    timing: assumedTiming,
    contest: computeContest(world, p, type, anticipation),
    staminaRatio: p.stamina / STAMINA.max,
    movingSpeed: planarSpeed(p),
    mods: p.mods,
  }).total;
  const points = shotPoints(world, p.pos.x, p.pos.z);
  return { pct, points, ev: pct * points, beyondArc };
}

/** Nearest opponent positioned between `p` and the rim (the one actually guarding him). */
export function frontDefender(world: World, p: SimPlayer, maxDist = 3): { player: SimPlayer | null; dist: number } {
  const toHoop = dirTo(p, world.hoop.x, world.hoop.z);
  let best: SimPlayer | null = null;
  let bestDist = maxDist;
  for (const o of world.players) {
    if (o.team === p.team) continue;
    const dx = o.pos.x - p.pos.x;
    const dz = o.pos.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d >= bestDist) continue;
    if (d > 0.2 && (dx * toHoop.x + dz * toHoop.z) / d < -0.1) continue;
    best = o;
    bestDist = d;
  }
  return { player: best, dist: bestDist };
}

/** 0 = lane wide open, 1 = a defender sits right in the lane toward the rim. */
export function driveLaneTraffic(world: World, p: SimPlayer): number {
  const { hoop } = world;
  let traffic = 0;
  for (const o of world.players) {
    if (o.team === p.team) continue;
    const { distSq, t } = pointSegmentDistSqXZ(o.pos.x, o.pos.z, p.pos.x, p.pos.z, hoop.x, hoop.z);
    if (t <= 0.02) continue;
    const width = 1.3;
    if (distSq < width * width) traffic = Math.max(traffic, 1 - Math.sqrt(distSq) / width);
  }
  return traffic;
}

/** Risk (0..1) that a pass from `from` to `to` gets intercepted. */
export function passLaneRisk(world: World, from: SimPlayer, to: SimPlayer): number {
  let risk = 0;
  for (const o of world.players) {
    if (o.team === from.team) continue;
    const { distSq, t } = pointSegmentDistSqXZ(o.pos.x, o.pos.z, from.pos.x, from.pos.z, to.pos.x, to.pos.z);
    if (t < 0.08 || t > 0.97) continue;
    const r = 1.2;
    if (distSq < r * r) risk = Math.max(risk, 1 - Math.sqrt(distSq) / r);
  }
  const dist = Math.hypot(to.pos.x - from.pos.x, to.pos.z - from.pos.z);
  return clamp(risk + Math.max(0, dist - 9) * 0.04, 0, 1);
}

/** Closest point beyond the arc from a position (plus a safety margin). */
export function nearestClearSpot(world: World, x: number, z: number, margin = 0.9): { x: number; z: number } {
  const local = toHoopLocal(world.hoop, x, z);
  const beyond = distanceBeyondArc(world.hoop, x, z);
  if (beyond > margin) return { x, z };
  const len = Math.hypot(local.lateral, local.out) || 1;
  const target = 6.75 + margin;
  let lateral = (local.lateral / len) * target;
  let out = (local.out / len) * target;
  if (out < 1.5) {
    // Corner region: step straight toward the sideline instead.
    lateral = Math.sign(local.lateral || 1) * Math.min(7.1, 6.6 + margin);
    out = Math.max(local.out, 0.3);
  }
  return fromHoopLocal(world.hoop, lateral, out);
}

/** Perimeter spacing spots (hoop-local lateral/out) used by off-ball offense. */
export const SPACING_SPOTS: ReadonlyArray<readonly [number, number]> = [
  [0, 7.6],
  [-5.2, 5.6],
  [5.2, 5.6],
  [-6.8, 0.9],
  [6.8, 0.9],
  [-2.2, 3.4],
  [2.2, 3.4],
];

export function spotWorld(world: World, spot: readonly [number, number]): { x: number; z: number } {
  return fromHoopLocal(world.hoop, spot[0], spot[1]);
}
