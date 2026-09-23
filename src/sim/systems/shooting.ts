import { clamp, clamp01, invLerp, lerp, vec3, type Vec3 } from '../../core/math';
import { ratingT } from '../../data/attributes';
import { distanceBeyondArc, type Hoop } from '../../data/court';
import { SHOOTING, SIM_DT, STAMINA, type ShotType, type ShotTypeTuning, type TimingGrade } from '../../data/tuning';
import type { Rng } from '../../core/rng';
import { dirTo, forwardX, forwardZ, handHeight, planarSpeed, rightX, rightZ } from '../geometry';
import type { SimPlayer } from '../types';
import type { World } from '../world';
import { createContacts, integrateBall, resetContacts, solveLaunchVelocity, type BallBody } from './ballPhysics';

/**
 * Shooting model. The make chance is an explainable sum of named factors (see
 * ShotBreakdown); the random roll decides the intended outcome, and the trajectory
 * planner searches for a physically simulated launch that produces exactly that outcome.
 * Scoring itself is always decided by ball physics.
 */

export function shotTuning(type: ShotType): ShotTypeTuning {
  return SHOOTING.types[type];
}

/** Rating that drives a shot type (three-pointers always use the threePoint rating). */
export function shotRating(player: SimPlayer, type: ShotType, beyondArc: boolean): number {
  if (beyondArc && (type === 'jumper' || type === 'pullUp' || type === 'fade' || type === 'stepback')) {
    return player.attr.threePoint;
  }
  const weights = shotTuning(type).ratings;
  let total = 0;
  let weightSum = 0;
  for (const [key, w] of Object.entries(weights) as Array<[keyof typeof weights, number]>) {
    total += player.attr[key] * w;
    weightSum += w;
  }
  return weightSum > 0 ? total / weightSum : 50;
}

export interface TimingWindows {
  perfect: number;
  good: number;
  ok: number;
}

export function timingWindows(player: SimPlayer, type: ShotType, beyondArc: boolean): TimingWindows {
  const range = SHOOTING.timingRatingRange;
  const scale = lerp(range[0], range[1], ratingT(shotRating(player, type, beyondArc))) * player.mods.shotWindow;
  const w = SHOOTING.timingWindows;
  return { perfect: w.perfect * scale, good: w.good * scale, ok: w.ok * scale };
}

export function gradeTiming(error: number, windows: TimingWindows): TimingGrade {
  const abs = Math.abs(error);
  if (abs <= windows.perfect) return 'perfect';
  if (abs <= windows.good) return 'good';
  if (abs <= windows.ok) return error < 0 ? 'early' : 'late';
  return 'poor';
}

export interface ShotContext {
  type: ShotType;
  rating: number;
  distance: number;
  beyondArc: boolean;
  /** Meters beyond the arc (0 inside). */
  deepMeters: number;
  timing: TimingGrade;
  contest: number;
  /** 0..1 where 1 = fully rested. */
  staminaRatio: number;
  movingSpeed: number;
  mods: SimPlayer['mods'];
}

export interface ShotBreakdown {
  base: number;
  distance: number;
  timing: number;
  contest: number;
  fatigue: number;
  movement: number;
  shotType: number;
  total: number;
}

export function computeShotChance(ctx: ShotContext): ShotBreakdown {
  const tuning = shotTuning(ctx.type);
  const t = ratingT(ctx.rating);
  const basePct = ctx.beyondArc ? SHOOTING.threeBasePct : tuning.basePct;
  const base = lerp(basePct[0], basePct[1], t);

  let distance = 0;
  if (ctx.beyondArc) {
    distance = -SHOOTING.deepFalloffPerMeter * ctx.deepMeters * ctx.mods.deepRangePenalty;
  } else if (tuning.usesMeter && ctx.type !== 'close' && ctx.type !== 'floater') {
    distance = -SHOOTING.midRangeFalloffPerMeter * Math.max(0, ctx.distance - 4.5);
  }
  if (ctx.distance > SHOOTING.maxRange) distance -= 0.25;

  const timing = tuning.usesMeter ? SHOOTING.timingBonus[ctx.timing] : 0;
  const contestMod = ctx.type === 'layup' || ctx.type === 'dunk' ? ctx.mods.finishingContact : ctx.mods.contestPenalty;
  const contest = -ctx.contest * SHOOTING.maxContestPenalty * tuning.contestSensitivity * contestMod;
  const fatigueT = clamp01((STAMINA.fatigueThreshold - ctx.staminaRatio * 100) / STAMINA.fatigueThreshold);
  const fatigue = -fatigueT * STAMINA.maxShotPenalty;
  const movement = ctx.type === 'jumper' && ctx.movingSpeed > SHOOTING.movingSpeedThreshold ? -SHOOTING.movingPenalty : 0;
  const shotType = -tuning.typePenalty;
  const total = clamp(base + distance + timing + contest + fatigue + movement + shotType, SHOOTING.minPct, SHOOTING.maxPct);
  return { base, distance, timing, contest, fatigue, movement, shotType, total };
}

/** Defender closing speed assumed when projecting a closeout. */
const CLOSEOUT_SPEED = 4.5;
/** Closest a closing-out defender gets before the release. */
const CLOSEOUT_STOP = 0.8;

/**
 * How contested a shot is, in [0,1]. Depends on defender distance, whether he is between
 * shooter and rim, height/reach advantage, jumping, defensive rating and balance.
 * `closeoutSeconds` > 0 projects each defender closing out for that long (used by the AI
 * to anticipate the contest at release rather than at decision time).
 */
export function computeContest(world: World, shooter: SimPlayer, type: ShotType, closeoutSeconds = 0): number {
  const cfg = SHOOTING.contest;
  const toHoop = dirTo(shooter, world.hoop.x, world.hoop.z);
  const interior = type === 'layup' || type === 'dunk' || type === 'close';
  let best = 0;
  let second = 0;
  for (const d of world.players) {
    if (d.team === shooter.team) continue;
    let dx = d.pos.x - shooter.pos.x;
    let dz = d.pos.z - shooter.pos.z;
    let dist = Math.sqrt(dx * dx + dz * dz);
    if (closeoutSeconds > 0 && dist > CLOSEOUT_STOP && d.action.kind !== 'stumble') {
      const closed = Math.min(dist - CLOSEOUT_STOP, CLOSEOUT_SPEED * closeoutSeconds);
      const k = (dist - closed) / dist;
      dx *= k;
      dz *= k;
      dist -= closed;
    }
    if (dist > cfg.range) continue;
    let value = Math.pow(invLerp(cfg.range, cfg.fullContestDistance, dist), cfg.falloffExponent);
    const cos = dist > 1e-4 ? (dx * toHoop.x + dz * toHoop.z) / dist : 1;
    value *= lerp(cfg.behindFactor, 1, clamp01((cos + 0.4) / 0.9));
    const heightAdvantage = handHeight(d) - (shooter.reach + shooter.pos.y);
    value *= clamp(1 + heightAdvantage * cfg.heightFactorPerMeter, 0.6, 1.4);
    if (d.airborne) value *= cfg.jumpingBonus;
    const defenseRating = interior ? d.attr.interiorDefense : d.attr.perimeterDefense;
    value *= lerp(0.8, 1.15, ratingT(defenseRating)) * d.mods.contestPower;
    if (d.action.kind === 'stumble') value *= 0.2;
    else if (d.action.kind === 'reachRecover') value *= 0.6;
    if (value > best) {
      second = best;
      best = value;
    } else if (value > second) {
      second = value;
    }
  }
  return clamp01(best + second * cfg.secondDefenderFactor);
}

/** Picks the shot type from court context (distance, drive speed, recent move). */
export function chooseShotType(world: World, player: SimPlayer): ShotType {
  const toHoop = dirTo(player, world.hoop.x, world.hoop.z);
  const dist = toHoop.dist;
  const speedToward = player.vel.x * toHoop.x + player.vel.z * toHoop.z;
  const speed = planarSpeed(player);
  const driving = speedToward > SHOOTING.driveSpeed;
  const dunkScore = player.attr.dunk + player.attr.vertical * 0.5 + (player.height - 1.9) * 60;

  if (dist <= SHOOTING.dunkRange && (driving || dist < 1.3) && dunkScore >= SHOOTING.dunkEligibility) return 'dunk';
  if (dist <= SHOOTING.layupRange && (driving || speedToward > SHOOTING.driveSpeed * 0.6)) return 'layup';
  if (dist <= SHOOTING.closeRange) return dist < 1.25 ? 'layup' : 'close';
  if (dist >= SHOOTING.floaterRange[0] && dist <= SHOOTING.floaterRange[1] && driving) return 'floater';
  if (player.sinceMove < SHOOTING.moveShotWindow && player.lastMoveShotStyle) return player.lastMoveShotStyle;
  if (speedToward < -1.4) return 'fade';
  if (speed > SHOOTING.movingSpeedThreshold) return 'pullUp';
  return 'jumper';
}

/** Minimum horizontal distance from the rim center for a layup release (outside the rim footprint). */
const LAYUP_RELEASE_RADIUS = 0.62;
/** Dunks release with the hand over the rim, close enough to clear the near rim tube. */
const DUNK_RELEASE_RADIUS = 0.07;

/**
 * Horizontal release spot for finishes at `radius` from the rim center, on the shooter's
 * side and never behind the backboard plane (baseline drives become reverse finishes).
 */
export function finishSpot(world: World, shooter: SimPlayer, radius: number, out: { x: number; z: number }): void {
  const hoop = world.hoop;
  let dx = shooter.pos.x - hoop.x;
  let dz = shooter.pos.z - hoop.z;
  // Keep the approach in front of the backboard (toward midcourt).
  const outward = -dz * hoop.dir;
  if (outward < 0.25) dz = -hoop.dir * 0.25;
  let len = Math.hypot(dx, dz);
  if (len < 1e-3) {
    dx = 0;
    dz = -hoop.dir;
    len = 1;
  }
  out.x = hoop.x + (dx / len) * radius;
  out.z = hoop.z + (dz / len) * radius;
}

/** Release point of the ball for a shot type. */
export function releasePoint(world: World, shooter: SimPlayer, type: ShotType, out: Vec3): Vec3 {
  const hoop = world.hoop;
  if (type === 'dunk') {
    finishSpot(world, shooter, DUNK_RELEASE_RADIUS, out);
    out.y = hoop.y + 0.3;
    return out;
  }
  if (type === 'layup') {
    finishSpot(world, shooter, LAYUP_RELEASE_RADIUS, out);
    out.y = Math.min(handHeight(shooter) - 0.1, hoop.y + 0.1);
    return out;
  }
  const lift = type === 'close' || type === 'floater' ? 1.08 : 1.14;
  out.x = shooter.pos.x + forwardX(shooter) * 0.22 + rightX(shooter) * 0.08 * shooter.hand;
  out.z = shooter.pos.z + forwardZ(shooter) * 0.22 + rightZ(shooter) * 0.08 * shooter.hand;
  out.y = shooter.pos.y + shooter.height * lift;
  return out;
}

export function shotPoints(world: World, x: number, z: number): number {
  return distanceBeyondArc(world.hoop, x, z) > 0 ? world.mode.pointsBeyondArc : world.mode.pointsInside;
}

export function isBeyondArc(world: World, x: number, z: number): boolean {
  return distanceBeyondArc(world.hoop, x, z) > 0;
}

// --- Trajectory planning -------------------------------------------------------------

export type SimulatedOutcome = 'make' | 'miss';

const scratchBody: BallBody = { pos: vec3(), vel: vec3() };
const scratchContacts = createContacts();

/**
 * Shared miss-resolution criterion for the live ball and the planner. A shot is only
 * resolved while descending: releases happen below rim height and must not count as
 * misses on the way up.
 */
export function isResolvedMiss(hoop: Hoop, pos: Vec3, vel: Vec3, touched: boolean): boolean {
  if (vel.y >= 0) return false;
  if (pos.y < hoop.y - 0.25) return true;
  if (!touched || pos.y > hoop.y + 0.1) return false;
  // After touching the rim/board, a ball near rim height outside the basket cylinder cannot score.
  const dx = pos.x - hoop.x;
  const dz = pos.z - hoop.z;
  return dx * dx + dz * dz > 0.5 * 0.5;
}

/** Runs the pure ball physics forward to see whether a launch scores. */
export function simulateShot(hoop: Hoop, from: Vec3, velocity: Vec3, maxSeconds = 3.5): SimulatedOutcome {
  scratchBody.pos.x = from.x;
  scratchBody.pos.y = from.y;
  scratchBody.pos.z = from.z;
  scratchBody.vel.x = velocity.x;
  scratchBody.vel.y = velocity.y;
  scratchBody.vel.z = velocity.z;
  let touched = false;
  const steps = Math.ceil(maxSeconds / SIM_DT);
  for (let i = 0; i < steps; i++) {
    resetContacts(scratchContacts);
    integrateBall(scratchBody, SIM_DT, hoop, scratchContacts, { hoopCollision: true, netGuide: false });
    if (scratchContacts.scored) return 'make';
    if (scratchContacts.rim > 0 || scratchContacts.backboard > 0) touched = true;
    if (scratchContacts.floor > 0) return 'miss';
    if (isResolvedMiss(hoop, scratchBody.pos, scratchBody.vel, touched)) return 'miss';
  }
  return 'miss';
}

export interface ShotPlan {
  release: Vec3;
  velocity: Vec3;
  outcome: SimulatedOutcome;
  flightTime: number;
}

/** Arc height for a shot type at a distance (flatter up close, higher from deep). */
export function arcHeightFor(type: ShotType, distance: number): number {
  const base = shotTuning(type).arcHeight;
  return type === 'dunk' || type === 'layup' ? base : base + 0.05 * Math.max(0, distance - 2);
}

/**
 * Finds a launch velocity whose simulated outcome matches `intendedMake`.
 * Candidate aim points are sampled deterministically from the match RNG.
 */
export function planShot(
  hoop: Hoop,
  release: Vec3,
  type: ShotType,
  intendedMake: boolean,
  timing: TimingGrade,
  rng: Rng,
): ShotPlan {
  const dx = hoop.x - release.x;
  const dz = hoop.z - release.z;
  const dist = Math.sqrt(dx * dx + dz * dz) || 1;
  // Rim-local axes: `fx,fz` points from the shooter toward the rim; `lx,lz` is lateral.
  const fx = dx / dist;
  const fz = dz / dist;
  const lx = -fz;
  const lz = fx;
  const velocity = vec3();
  const target = vec3(hoop.x, hoop.y, hoop.z);
  const airballAllowed = !intendedMake && (timing === 'poor' || dist > SHOOTING.maxRange) && type !== 'dunk' && type !== 'layup';
  let flightTime = 0;
  let outcome: SimulatedOutcome = 'miss';

  for (let attempt = 0; attempt < 10; attempt++) {
    let along: number;
    let lateral: number;
    if (intendedMake) {
      // Slightly long rather than short so the ball clears the front rim.
      const spread = attempt < 5 ? SHOOTING.makeAimRadius : SHOOTING.makeAimRadius * 0.4;
      along = rng.range(0, spread * 1.2);
      lateral = rng.range(-spread, spread);
    } else if (airballAllowed && attempt === 0 && rng.chance(0.45)) {
      const r = rng.range(SHOOTING.airballAimRange[0], SHOOTING.airballAimRange[1]);
      along = rng.chance(0.6) ? -r : r * 0.6;
      lateral = rng.range(-0.3, 0.3);
    } else {
      const r = rng.range(SHOOTING.missAimRange[0], SHOOTING.missAimRange[1]);
      const side = rng.next();
      if (side < 0.4) {
        along = -r; // short: front rim
        lateral = rng.range(-0.08, 0.08);
      } else if (side < 0.75) {
        along = r; // long: back rim / backboard
        lateral = rng.range(-0.08, 0.08);
      } else {
        along = rng.range(-0.08, 0.08);
        lateral = rng.chance(0.5) ? r : -r;
      }
    }
    target.x = hoop.x + fx * along + lx * lateral;
    target.z = hoop.z + fz * along + lz * lateral;
    target.y = hoop.y;
    const arc = arcHeightFor(type, dist) + rng.range(-0.08, 0.08);
    flightTime = solveLaunchVelocity(release, target, arc, velocity);
    outcome = simulateShot(hoop, release, velocity);
    if ((outcome === 'make') === intendedMake) break;
  }
  return { release: vec3(release.x, release.y, release.z), velocity, outcome, flightTime };
}

/** Dunks push the ball down through the rim from above; misses rattle off the rim. */
export function planDunk(hoop: Hoop, release: Vec3, intendedMake: boolean, rng: Rng): ShotPlan {
  if (intendedMake) {
    const velocity = vec3();
    for (let attempt = 0; attempt < 6; attempt++) {
      const jitter = 0.03 / (attempt + 1);
      const tx = hoop.x + rng.range(-jitter, jitter);
      const tz = hoop.z + rng.range(-jitter, jitter);
      velocity.x = (tx - release.x) / 0.12;
      velocity.z = (tz - release.z) / 0.12;
      velocity.y = -2.6;
      if (simulateShot(hoop, release, velocity) === 'make') {
        return { release: vec3(release.x, release.y, release.z), velocity, outcome: 'make', flightTime: 0.12 };
      }
    }
  }
  // Missed dunk: slammed off the rim.
  const miss = vec3();
  let outcome: SimulatedOutcome = 'make';
  for (let attempt = 0; attempt < 8 && outcome === 'make'; attempt++) {
    const angle = rng.range(0, Math.PI * 2);
    const radius = rng.range(0.25, 0.32);
    miss.x = (hoop.x + Math.cos(angle) * radius - release.x) / 0.12;
    miss.z = (hoop.z + Math.sin(angle) * radius - release.z) / 0.12;
    miss.y = rng.range(-2.6, -1.8);
    outcome = simulateShot(hoop, release, miss);
  }
  return { release: vec3(release.x, release.y, release.z), velocity: miss, outcome, flightTime: 0.12 };
}
