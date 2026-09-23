import { clamp, lerp } from '../../core/math';
import { ratingT } from '../../data/attributes';
import { DRIBBLE_MOVES, DRIBBLE_MOVE_IDS, type DribbleMoveDef, type DribbleMoveId, type MoveTrigger } from '../../data/dribbleMoves';
import { DRIBBLE, STAMINA } from '../../data/tuning';
import { resetAction } from '../playerFactory';
import { forwardX, forwardZ, rightX, rightZ } from '../geometry';
import type { SimPlayer } from '../types';
import { emit, type World } from '../world';
import { staminaDrainScale } from './stamina';

/**
 * Data-driven dribble moves. Selection depends on stick direction relative to the
 * handler's facing and ball hand; execution (displacement, hand switch, exposure,
 * defender unbalancing) is entirely parameterized by DribbleMoveDef.
 */

const TRIGGER_TO_MOVE = new Map<MoveTrigger, DribbleMoveId>(
  DRIBBLE_MOVE_IDS.map((id) => [DRIBBLE_MOVES[id].trigger, id] as const),
);

export interface MoveSelection {
  trigger: MoveTrigger;
  /** -1 = left, 1 = right (player-relative), 0 = none. */
  side: -1 | 0 | 1;
}

/** Classifies a world-space stick vector relative to the player's facing and ball hand. */
export function classifyMoveTrigger(p: SimPlayer, moveX: number, moveZ: number): MoveSelection {
  const mag = Math.sqrt(moveX * moveX + moveZ * moveZ);
  if (mag < 0.3) return { trigger: 'neutral', side: 0 };
  const lateral = (moveX * rightX(p) + moveZ * rightZ(p)) / mag;
  const forward = (moveX * forwardX(p) + moveZ * forwardZ(p)) / mag;
  const angle = Math.abs(Math.atan2(lateral, forward));
  const side: -1 | 1 = lateral >= 0 ? 1 : -1;
  const deg = (angle * 180) / Math.PI;
  if (deg < 30) return { trigger: 'forward', side: 0 };
  if (deg > 150) return { trigger: 'back', side: 0 };
  if (deg < 72) return { trigger: 'forwardDiagonal', side };
  if (deg > 108) return { trigger: 'backDiagonal', side };
  return { trigger: side === p.hand ? 'ballHandSide' : 'offHandSide', side };
}

/** Resolves the move for a trigger, downgrading when the handler lacks the required handle. */
export function resolveMove(p: SimPlayer, trigger: MoveTrigger): DribbleMoveDef | null {
  let id: DribbleMoveId | null = TRIGGER_TO_MOVE.get(trigger) ?? null;
  while (id) {
    const move: DribbleMoveDef = DRIBBLE_MOVES[id];
    if (p.attr.ballHandle >= move.minHandle) return move;
    id = move.fallback;
  }
  return null;
}

export function startDribbleMove(world: World, p: SimPlayer, moveX: number, moveZ: number): boolean {
  if (p.airborne || p.action.kind !== 'none') return false;
  const selection = classifyMoveTrigger(p, moveX, moveZ);
  const move = resolveMove(p, selection.trigger);
  if (!move) return false;

  let cost = move.staminaCost * staminaDrainScale(p);
  if (p.sinceMove < DRIBBLE.chainWindow) cost *= DRIBBLE.chainStaminaMultiplier;
  if (p.stamina < cost * 0.5) return false;
  p.stamina = Math.max(0, p.stamina - cost);

  // Side of the move: stick side for lateral/diagonal moves; crossover goes to the off hand.
  let side = selection.side;
  if (side === 0) side = move.switchesHand ? (-p.hand as -1 | 1) : p.hand;

  const a = p.action;
  resetAction(a);
  a.kind = 'dribbleMove';
  a.moveId = move.id;
  a.duration = move.duration * lerp(1.08, 0.92, ratingT(p.attr.ballHandle));
  a.dirX = forwardX(p);
  a.dirZ = forwardZ(p);
  a.sideX = rightX(p) * side;
  a.sideZ = rightZ(p) * side;
  if (move.switchesHand) p.hand = side;
  emit(world, { type: 'dribbleMove', player: p.id, move: move.id });
  return true;
}

export function updateDribbleMove(world: World, p: SimPlayer): void {
  const a = p.action;
  const move = a.moveId ? DRIBBLE_MOVES[a.moveId] : null;
  if (!move) {
    resetAction(a);
    return;
  }
  if (!a.resolved && a.t >= a.duration * move.beatMoment) {
    a.resolved = true;
    tryBeatDefender(world, p, move);
  }
  if (a.t >= a.duration) {
    p.boostMultiplier = move.exitSpeedMultiplier;
    p.boostTime = move.exitDuration;
    p.sinceMove = 0;
    p.lastMoveShotStyle = move.shotStyle;
    resetAction(a);
  }
}

/** Rolls whether the move unbalances the nearest on-ball defender. */
function tryBeatDefender(world: World, p: SimPlayer, move: DribbleMoveDef): void {
  let defender: SimPlayer | null = null;
  let bestDist: number = DRIBBLE.beatRange;
  for (const d of world.players) {
    if (d.team === p.team || d.action.kind === 'stumble') continue;
    const dx = d.pos.x - p.pos.x;
    const dz = d.pos.z - p.pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist >= bestDist) continue;
    // Defender must be roughly in front of the handler.
    const front = dist > 1e-4 ? (dx * p.action.dirX + dz * p.action.dirZ) / dist : 1;
    if (front < -0.2) continue;
    defender = d;
    bestDist = dist;
  }
  if (!defender) return;

  const affinity = move.archetypeAffinity[p.archetype] ?? 1;
  let chance = DRIBBLE.beatBase + (p.attr.ballHandle - defender.attr.perimeterDefense) * DRIBBLE.beatRatingWeight;
  // Defender leaning the wrong way (moving opposite the move's lateral direction).
  const lean = defender.vel.x * p.action.sideX + defender.vel.z * p.action.sideZ;
  if (lean < -0.8) chance += 0.12;
  const committed = defender.action.kind === 'steal' || defender.action.kind === 'reachRecover' || defender.airborne;
  if (committed) chance += DRIBBLE.beatCommittedBonus;
  const fatigue = clamp((STAMINA.fatigueThreshold - p.stamina) / STAMINA.fatigueThreshold, 0, 1);
  chance *= move.beatPower * affinity * p.mods.dribbleBeat * (1 - fatigue * 0.3);
  chance *= lerp(1.15, 0.85, ratingT(defender.attr.defensiveIQ));
  chance = clamp(chance, 0, DRIBBLE.maxBeatChance);
  const roll = world.rng.next();
  if (roll >= chance) return;

  const severity = 1 - roll / Math.max(chance, 1e-6);
  const range = DRIBBLE.stumbleDuration;
  const da = defender.action;
  resetAction(da);
  da.kind = 'stumble';
  da.duration = lerp(range[0], range[1], severity);
  emit(world, { type: 'defenderBeaten', player: p.id, defender: defender.id, severity });
}

/** Cosmetic dribble cadence (bounces/sec) from current speed; rendered by the view layer. */
export function dribbleRate(p: SimPlayer): number {
  const speed = Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z);
  return lerp(DRIBBLE.bounceRateIdle, DRIBBLE.bounceRateSprint, clamp(speed / 6, 0, 1));
}

/** Archetype-level dribble capability summary (used by UI/AI). */
export function preferredMoves(p: SimPlayer): DribbleMoveId[] {
  return DRIBBLE_MOVE_IDS.filter((id) => p.attr.ballHandle >= DRIBBLE_MOVES[id].minHandle).sort(
    (a, b) => (DRIBBLE_MOVES[b].archetypeAffinity[p.archetype] ?? 1) - (DRIBBLE_MOVES[a].archetypeAffinity[p.archetype] ?? 1),
  );
}

