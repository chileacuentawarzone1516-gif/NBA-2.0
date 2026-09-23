import { copy3, vec3 } from '../core/math';
import { Rng } from '../core/rng';
import { createHoop, halfCourtBounds, type CourtBounds, type Hoop } from '../data/court';
import type { ModeConfig } from '../data/modes';
import { SIM_DT } from '../data/tuning';
import { emptyInput, type PlayerInput } from './input';
import { createSimPlayer, type RosterEntry } from './playerFactory';
import { processInput, updateActions } from './systems/actions';
import { updateBall } from './systems/ballUpdate';
import { clampToBounds, resolvePlayerContacts, updatePlayerMovement } from './systems/movement';
import { setupCheck, updateRules } from './systems/rules';
import { updateStamina } from './systems/stamina';
import type { BallState, MatchState, SimEvent, SimPlayer, TeamIndex } from './types';
import type { World } from './world';

export interface MatchSetup {
  mode: ModeConfig;
  seed: number;
  teams: readonly [readonly RosterEntry[], readonly RosterEntry[]];
  firstOffense?: TeamIndex;
}

const NO_INPUT: PlayerInput = Object.freeze(emptyInput()) as PlayerInput;
/** Distance within which a defender automatically drops into a defensive stance. */
const STANCE_RANGE = 3.2;

/**
 * Deterministic basketball simulation. Advance it with `step(inputs)` at SIM_HZ.
 * It has no DOM or rendering dependencies, so it runs identically in the browser,
 * in unit tests and on a future authoritative server.
 */
export class Simulation implements World {
  readonly mode: ModeConfig;
  readonly hoop: Hoop;
  readonly bounds: CourtBounds;
  readonly rng: Rng;
  readonly players: SimPlayer[] = [];
  readonly ball: BallState;
  readonly match: MatchState;
  readonly events: SimEvent[] = [];
  time = 0;

  constructor(setup: MatchSetup) {
    this.mode = setup.mode;
    this.hoop = createHoop(1);
    this.bounds = halfCourtBounds(1);
    this.rng = new Rng(setup.seed);

    setup.teams.forEach((roster, teamIndex) => {
      roster.forEach((entry, slot) => {
        this.players.push(createSimPlayer(this.players.length, teamIndex as TeamIndex, slot, entry));
      });
    });
    if (this.players.length === 0) throw new Error('Simulation requires at least one player');
    if (this.players.length > 31) throw new Error('Simulation supports at most 31 players');

    this.ball = {
      phase: 'dead', holder: -1, pos: vec3(0, 1, 0), prevPos: vec3(0, 1, 0), vel: vec3(),
      lastTouch: -1, lastTouchTeam: 0, lastHolder: -1, shot: null, pass: null, looseReason: 'none',
      phaseTime: 0, netTime: 0, restTime: 0, dribblePhase: 0,
    };
    this.match = {
      phase: 'check', phaseTime: 0, offense: 0, score: [0, 0], gameClock: this.mode.gameClock,
      shotClock: this.mode.shotClock, needsClear: false, overtime: false, winner: -1,
      nextOffense: 0, deadReason: 'none', horn: false, tick: 0,
    };
    const first = setup.firstOffense ?? (this.mode.hasOpponents ? (this.rng.chance(0.5) ? 0 : 1) : 0);
    setupCheck(this, first);
  }

  /** Advances one fixed step. `inputs[i]` drives `players[i]`; missing entries mean no input. */
  step(inputs: ReadonlyArray<PlayerInput | undefined>): void {
    this.events.length = 0;
    const dt = SIM_DT;
    const { match, players } = this;
    match.tick++;

    for (const p of players) {
      copy3(p.prevPos, p.pos);
      p.prevFacing = p.facing;
    }
    copy3(this.ball.prevPos, this.ball.pos);

    const acceptsInput = match.phase === 'live' || match.phase === 'dead';
    for (const p of players) p.inStance = this.computeStance(p);
    for (const p of players) processInput(this, p, inputs[p.id] ?? NO_INPUT);
    for (const p of players) updateActions(this, p, dt);
    for (const p of players) {
      const input = acceptsInput ? (inputs[p.id] ?? NO_INPUT) : NO_INPUT;
      updatePlayerMovement(this, p, input, dt);
    }
    resolvePlayerContacts(this);
    for (const p of players) {
      clampToBounds(this, p);
      updateStamina(p, dt);
    }
    updateBall(this, dt);
    updateRules(this, dt);
    this.time += dt;
  }

  isOver(): boolean {
    return this.match.phase === 'final';
  }

  private computeStance(p: SimPlayer): boolean {
    const { ball, match } = this;
    if (p.team === match.offense || match.phase !== 'live' || ball.phase !== 'held') return false;
    if (p.sprinting || p.airborne) return false;
    const k = p.action.kind;
    if (k !== 'none' && k !== 'steal' && k !== 'reachRecover') return false;
    const holder = this.players[ball.holder];
    if (!holder) return false;
    const dx = holder.pos.x - p.pos.x;
    const dz = holder.pos.z - p.pos.z;
    return dx * dx + dz * dz < STANCE_RANGE * STANCE_RANGE;
  }
}
