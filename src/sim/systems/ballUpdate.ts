import { BALL } from '../../data/tuning';
import { ballCarryPoint } from '../geometry';
import { emit, type World } from '../world';
import { createContacts, integrateBall, resetContacts } from './ballPhysics';
import { checkBlocks } from './defense';
import { dribbleRate } from './dribbling';
import { updatePassFlight } from './passing';
import { makeLoose } from './possession';
import { updateLooseBall } from './rebounding';
import { onOutOfBounds, onScore } from './rules';
import { isResolvedMiss } from './shooting';

/** Advances the ball according to its possession phase. */

const contacts = createContacts();
/** Minimum impact speed that produces an audible/visible contact event. */
const IMPACT_EVENT_SPEED = 0.9;

export function updateBall(world: World, dt: number): void {
  const { ball } = world;
  ball.phaseTime += dt;

  if (ball.phase === 'held') {
    const holder = world.players[ball.holder];
    if (holder) {
      ballCarryPoint(holder, ball.pos);
      ball.dribblePhase = (ball.dribblePhase + dribbleRate(holder) * dt) % 1;
    }
    return;
  }

  if (ball.phase === 'shot' && ball.shot) {
    ball.shot.t += dt;
    checkBlocks(world);
  }

  const inNet = ball.netTime > 0;
  if (inNet) ball.netTime = Math.max(0, ball.netTime - dt);
  resetContacts(contacts);
  integrateBall(ball, dt, world.hoop, contacts, { hoopCollision: !inNet, netGuide: inNet });
  emitContactEvents(world);

  switch (ball.phase) {
    case 'shot':
      updateShotFlight(world);
      break;
    case 'pass':
      updatePassFlight(world, dt);
      break;
    case 'loose':
      updateRest(world, dt);
      if (isOutOfBounds(world)) {
        onOutOfBounds(world);
        return;
      }
      updateLooseBall(world);
      break;
    case 'dead':
      break;
  }
}

function emitContactEvents(world: World): void {
  if (contacts.rim > IMPACT_EVENT_SPEED) emit(world, { type: 'rim', strength: contacts.rim });
  if (contacts.backboard > IMPACT_EVENT_SPEED) emit(world, { type: 'backboard', strength: contacts.backboard });
  if (contacts.floor > IMPACT_EVENT_SPEED) emit(world, { type: 'floorBounce', strength: contacts.floor });
}

function updateShotFlight(world: World): void {
  const { ball } = world;
  const shot = ball.shot;
  if (!shot) return;
  if (contacts.rim > 0 || contacts.backboard > 0) shot.touchedRim = true;
  if (contacts.scored) {
    onScore(world, shot);
    return;
  }
  if (contacts.floor > 0 || isResolvedMiss(world.hoop, ball.pos, ball.vel, shot.touchedRim)) {
    shot.resolved = true;
    emit(world, { type: 'miss', player: shot.shooter });
    makeLoose(world, 'rebound', null);
    // Shot clock resets when the rim is touched (offense keeps a fresh clock on a board).
    if (shot.touchedRim && world.mode.shotClock !== null) world.match.shotClock = world.mode.shotClock;
  }
}

function updateRest(world: World, dt: number): void {
  const { ball } = world;
  if (ball.pos.y <= BALL.radius + 0.02 && Math.abs(ball.vel.y) < 0.5) ball.restTime += dt;
  else ball.restTime = 0;
}

function isOutOfBounds(world: World): boolean {
  const { ball, bounds } = world;
  if (ball.pos.y > 3.2) return false;
  const r = BALL.radius;
  return (
    ball.pos.x < bounds.minX - r ||
    ball.pos.x > bounds.maxX + r ||
    ball.pos.z < bounds.minZ - r ||
    ball.pos.z > bounds.maxZ + r
  );
}

