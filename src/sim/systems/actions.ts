import { vec3 } from '../../core/math';
import { distanceBeyondArc } from '../../data/court';
import { PASSING, SHOOTING, STAMINA } from '../../data/tuning';
import { Button, wasPressed, wasReleased, type PlayerInput } from '../input';
import { resetAction } from '../playerFactory';
import { planarSpeed } from '../geometry';
import type { SimPlayer } from '../types';
import { emit, type World } from '../world';
import { startDribbleMove, updateDribbleMove } from './dribbling';
import { startJump, startSteal, updateJump, updateSteal } from './defense';
import { startJumpPhysics } from './movement';
import { selectPassTarget, startPass, updatePassAction } from './passing';
import {
  chooseShotType,
  computeContest,
  finishSpot,
  computeShotChance,
  gradeTiming,
  planDunk,
  planShot,
  releasePoint,
  shotPoints,
  shotRating,
  shotTuning,
  timingWindows,
} from './shooting';
import { spendStamina } from './stamina';

/**
 * Translates per-tick input into actions and advances action timelines.
 * All action state lives in `SimPlayer.action`; this module is the only place that
 * starts or ends actions (besides defensive reactions such as stumbles).
 */

/** Releasing the shoot button before this time (and before leaving the floor) is a pump fake. */
const PUMP_FAKE_WINDOW = 0.14;
const PUMP_FAKE_DURATION = 0.34;
const releaseScratch = vec3();
const approachScratch = { x: 0, z: 0 };

const JUMP_FRACTION: Record<string, number> = {
  jumper: 0.36, pullUp: 0.36, stepback: 0.34, fade: 0.3, close: 0.3, floater: 0.4, layup: 0.8, dunk: 1,
};

export function processInput(world: World, p: SimPlayer, input: PlayerInput): void {
  const prev = p.prevButtons;
  p.prevButtons = input.buttons;
  if (world.match.phase !== 'live') return;

  const { ball } = world;
  const holding = ball.phase === 'held' && ball.holder === p.id;
  const a = p.action;

  if (holding) {
    if (a.kind === 'shotGather') {
      if (wasReleased(input, prev, Button.Shoot) && !p.autoRelease) {
        if (a.t < PUMP_FAKE_WINDOW && !p.airborne) pumpFake(world, p);
        else releaseShot(world, p);
      }
      return;
    }
    if (a.kind !== 'none') return;
    if (wasPressed(input, prev, Button.Shoot)) {
      startShot(world, p);
    } else if (wasPressed(input, prev, Button.Pass)) {
      const receiver = input.passTarget >= 0 ? world.players[input.passTarget] : selectPassTarget(world, p, input.moveX, input.moveZ);
      if (receiver && receiver.team === p.team && receiver.id !== p.id) startPass(p, receiver);
    } else if (wasPressed(input, prev, Button.Skill)) {
      startDribbleMove(world, p, input.moveX, input.moveZ);
    }
    return;
  }

  const defending = p.team !== world.match.offense;
  if (wasPressed(input, prev, Button.Skill) && defending) {
    startSteal(p);
  } else if (wasPressed(input, prev, Button.Shoot) || wasPressed(input, prev, Button.Jump)) {
    startJump(world, p);
  } else if (wasPressed(input, prev, Button.Pass) && !defending) {
    p.callForBall = 1.2;
  }
}

export function startShot(world: World, p: SimPlayer): void {
  const type = chooseShotType(world, p);
  const tuning = shotTuning(type);
  const a = p.action;
  resetAction(a);
  a.shotType = type;
  a.releaseTime = tuning.releaseTime;
  spendStamina(p, STAMINA.shotCost);

  if (type === 'layup' || type === 'dunk') {
    a.kind = type;
    // Take-off target next to the rim (in front of the backboard).
    finishSpot(world, p, type === 'dunk' ? 0.5 : 0.8, approachScratch);
    a.dirX = approachScratch.x;
    a.dirZ = approachScratch.z;
    a.duration = tuning.releaseTime + 0.45;
  } else {
    a.kind = 'shotGather';
    a.duration = SHOOTING.maxHoldTime;
  }
  emit(world, {
    type: 'shotStart',
    player: p.id,
    shotType: type,
    releaseTime: tuning.releaseTime,
    usesMeter: tuning.usesMeter && !p.autoRelease,
  });
}

function pumpFake(world: World, p: SimPlayer): void {
  const a = p.action;
  resetAction(a);
  a.kind = 'pumpFake';
  a.duration = PUMP_FAKE_DURATION;
  emit(world, { type: 'pumpFake', player: p.id });
}

/** Jump start aligned so the apex of the shot jump coincides with the ideal release. */
function jumpStartTime(releaseTime: number): number {
  return Math.max(0, releaseTime - 0.3);
}

function releaseShot(world: World, p: SimPlayer): void {
  const { ball, hoop, match } = world;
  const a = p.action;
  const type = a.shotType ?? 'jumper';
  const tuning = shotTuning(type);
  const beyond = distanceBeyondArc(hoop, p.pos.x, p.pos.z);
  const beyondArc = beyond > 0;
  const error = a.t - a.releaseTime;
  const timing = !tuning.usesMeter || p.autoRelease ? 'good' : gradeTiming(error, timingWindows(p, type, beyondArc));
  const contest = computeContest(world, p, type);
  const release = releasePoint(world, p, type, releaseScratch);
  const distance = Math.hypot(hoop.x - p.pos.x, hoop.z - p.pos.z);
  const chance = computeShotChance({
    type,
    rating: shotRating(p, type, beyondArc),
    distance,
    beyondArc,
    deepMeters: Math.max(0, beyond),
    timing,
    contest,
    staminaRatio: p.stamina / STAMINA.max,
    movingSpeed: planarSpeed(p),
    mods: p.mods,
  });
  const intendedMake = world.rng.chance(chance.total);
  const plan = type === 'dunk' ? planDunk(hoop, release, intendedMake, world.rng) : planShot(hoop, release, type, intendedMake, timing, world.rng);
  const points = shotPoints(world, p.pos.x, p.pos.z);

  ball.phase = 'shot';
  ball.holder = -1;
  ball.lastHolder = p.id;
  ball.lastTouch = p.id;
  ball.lastTouchTeam = p.team;
  ball.phaseTime = 0;
  ball.pos.x = plan.release.x;
  ball.pos.y = plan.release.y;
  ball.pos.z = plan.release.z;
  ball.vel.x = plan.velocity.x;
  ball.vel.y = plan.velocity.y;
  ball.vel.z = plan.velocity.z;
  ball.shot = {
    shooter: p.id,
    team: p.team,
    type,
    points,
    pct: chance.total,
    timing,
    timingError: error,
    contest,
    distance,
    intendedMake,
    assist: p.sinceCatch < PASSING.assistWindow ? p.lastPasser : -1,
    uncleared: match.needsClear,
    t: 0,
    blocked: false,
    blockRolled: 0,
    scored: false,
    touchedRim: false,
    resolved: false,
  };
  p.stats.fga++;
  if (points === 3) p.stats.tpa++;

  a.released = true;
  if (a.kind === 'shotGather') {
    a.kind = 'shotFollow';
    a.t = 0;
    a.duration = 0.25;
  }
  emit(world, { type: 'shotRelease', player: p.id, shotType: type, pct: chance.total, timing, timingError: error, contest, distance, points });
}

/** Advances action timers and resolves action-specific moments. */
export function updateActions(world: World, p: SimPlayer, dt: number): void {
  p.sinceMove += dt;
  p.sinceCatch += dt;
  if (p.stealCooldown > 0) p.stealCooldown = Math.max(0, p.stealCooldown - dt);
  if (p.callForBall > 0) p.callForBall = Math.max(0, p.callForBall - dt);

  const a = p.action;
  if (a.kind === 'none') return;
  a.t += dt;
  const { ball } = world;
  const holding = ball.phase === 'held' && ball.holder === p.id;

  switch (a.kind) {
    case 'dribbleMove':
      if (!holding) resetAction(a);
      else updateDribbleMove(world, p);
      break;
    case 'shotGather': {
      if (!holding) {
        resetAction(a);
        break;
      }
      const type = a.shotType ?? 'jumper';
      // `resolved` marks that the shot jump has started (jump once per shot).
      if (!a.resolved && !p.airborne && a.t >= jumpStartTime(a.releaseTime)) {
        a.resolved = true;
        startJumpPhysics(p, JUMP_FRACTION[type] ?? 0.35, 0.6);
      }
      if ((p.autoRelease && a.t >= a.releaseTime) || a.t >= SHOOTING.maxHoldTime) releaseShot(world, p);
      break;
    }
    case 'layup':
    case 'dunk': {
      const type = a.kind;
      if (!a.released && !holding) {
        resetAction(a);
        break;
      }
      if (!a.resolved && !p.airborne && a.t >= jumpStartTime(a.releaseTime)) {
        a.resolved = true;
        startJumpPhysics(p, JUMP_FRACTION[type] ?? 0.8, 0.62);
      }
      if (!a.released && a.t >= a.releaseTime) releaseShot(world, p);
      if (a.released && !p.airborne && a.t >= a.duration) resetAction(a);
      break;
    }
    case 'shotFollow':
      if (!p.airborne && a.t >= a.duration) resetAction(a);
      break;
    case 'pass':
      updatePassAction(world, p);
      break;
    case 'steal':
      updateSteal(world, p);
      break;
    case 'jump':
      updateJump(p);
      break;
    case 'stumble':
    case 'reachRecover':
    case 'pumpFake':
      if (a.t >= a.duration) resetAction(a);
      break;
    default:
      break;
  }
}
