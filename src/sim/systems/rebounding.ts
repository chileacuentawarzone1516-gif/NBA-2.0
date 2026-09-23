import { vec3, type Vec3 } from '../../core/math';
import { ratingT } from '../../data/attributes';
import { BALL, REBOUND, SIM_DT } from '../../data/tuning';
import { handHeight } from '../geometry';
import type { SimPlayer } from '../types';
import type { World } from '../world';
import { createContacts, integrateBall, resetContacts, type BallBody } from './ballPhysics';
import { giveBall } from './possession';

/**
 * Loose-ball and rebound resolution. Reachable players compete with weights from
 * rebounding ratings, positioning (box-out), jumping and proximity; the roll is weighted,
 * so positioning and timing matter more than luck.
 */

function canReach(world: World, p: SimPlayer): number {
  const { ball, hoop } = world;
  if (p.action.kind === 'stumble') return 0;
  const dx = ball.pos.x - p.pos.x;
  const dz = ball.pos.z - p.pos.z;
  const distSq = dx * dx + dz * dz;
  const reboundRating = p.team === world.match.offense ? p.attr.offensiveRebound : p.attr.defensiveRebound;
  const radius = REBOUND.grabRadius + REBOUND.grabRatingBonus * ratingT(reboundRating);
  if (distSq > radius * radius) return 0;
  const top = handHeight(p) + (p.airborne ? 0.1 : REBOUND.maxStandingGrabBuffer);
  if (ball.pos.y > top) return 0;
  // Basket interference: the ball inside the cylinder above the rim is untouchable.
  const hx = ball.pos.x - hoop.x;
  const hz = ball.pos.z - hoop.z;
  if (ball.pos.y > hoop.y - 0.1 && hx * hx + hz * hz < REBOUND.rimCylinderRadius * REBOUND.rimCylinderRadius) return 0;
  return 1 - Math.sqrt(distSq) / radius;
}

function isBoxingOut(world: World, p: SimPlayer): boolean {
  const { ball } = world;
  for (const o of world.players) {
    if (o.team === p.team) continue;
    const dx = o.pos.x - p.pos.x;
    const dz = o.pos.z - p.pos.z;
    if (dx * dx + dz * dz > 1.1 * 1.1) continue;
    // p is between the opponent and the ball.
    const bx = ball.pos.x - p.pos.x;
    const bz = ball.pos.z - p.pos.z;
    if (dx * bx + dz * bz < 0) return true;
  }
  return false;
}

const weights = new Float64Array(32);

export function updateLooseBall(world: World): void {
  const { ball } = world;
  if (ball.phase !== 'loose') return;
  // A freshly deflected/blocked ball cannot be re-grabbed by the same touch instantly.
  if (ball.phaseTime < 0.08) return;

  let total = 0;
  for (let i = 0; i < world.players.length; i++) {
    const p = world.players[i]!;
    const proximity = canReach(world, p);
    let w = 0;
    if (proximity > 0) {
      const offensive = ball.shot ? p.team === ball.shot.team : p.team === world.match.offense;
      const rating = offensive ? p.attr.offensiveRebound : p.attr.defensiveRebound;
      w = (0.35 + ratingT(rating)) * (0.4 + proximity) * p.mods.reboundWeight;
      if (offensive) w *= REBOUND.offensiveWeight;
      if (p.airborne) w *= REBOUND.jumpGrabBonus;
      if (isBoxingOut(world, p)) w *= REBOUND.boxOutBonus;
    }
    weights[i] = w;
    total += w;
  }
  if (total <= 0) return;
  let roll = world.rng.next() * total;
  for (let i = 0; i < world.players.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0 && weights[i]! > 0) {
      const winner = world.players[i]!;
      const isRebound = ball.looseReason === 'rebound' || ball.looseReason === 'block';
      giveBall(world, winner, isRebound ? 'rebound' : 'loose');
      return;
    }
  }
}

const predictBody: BallBody = { pos: vec3(), vel: vec3() };
const predictContacts = createContacts();

/**
 * Predicts where a loose/shot ball will first be catchable (below `catchHeight` while
 * descending) using the same physics as the live ball. Used by the AI to position.
 */
export function predictLanding(world: World, catchHeight: number, out: Vec3): number {
  const { ball, hoop } = world;
  predictBody.pos.x = ball.pos.x;
  predictBody.pos.y = ball.pos.y;
  predictBody.pos.z = ball.pos.z;
  predictBody.vel.x = ball.vel.x;
  predictBody.vel.y = ball.vel.y;
  predictBody.vel.z = ball.vel.z;
  const steps = Math.ceil(BALL.predictionSeconds / SIM_DT);
  for (let i = 1; i <= steps; i++) {
    resetContacts(predictContacts);
    integrateBall(predictBody, SIM_DT, hoop, predictContacts, { hoopCollision: true, netGuide: false });
    if (predictBody.vel.y < 0 && predictBody.pos.y <= catchHeight) {
      out.x = predictBody.pos.x;
      out.y = predictBody.pos.y;
      out.z = predictBody.pos.z;
      return i * SIM_DT;
    }
  }
  out.x = predictBody.pos.x;
  out.y = predictBody.pos.y;
  out.z = predictBody.pos.z;
  return BALL.predictionSeconds;
}
