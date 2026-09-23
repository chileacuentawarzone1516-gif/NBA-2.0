import type { Vec2, Vec3 } from '../core/math';
import type { ArchetypeId, Tendencies } from '../data/archetypes';
import type { Attributes, Position } from '../data/attributes';
import type { DribbleMoveId } from '../data/dribbleMoves';
import type { GameplayModifiers } from '../data/modifiers';
import type { PlayerLook } from '../data/players';
import type { ShotType, TimingGrade } from '../data/tuning';

export type TeamIndex = 0 | 1;

export function otherTeam(team: TeamIndex): TeamIndex {
  return team === 0 ? 1 : 0;
}

export type ActionKind =
  | 'none'
  | 'dribbleMove'
  | 'shotGather'
  | 'shotFollow'
  | 'layup'
  | 'dunk'
  | 'pass'
  | 'steal'
  | 'jump'
  | 'stumble'
  | 'reachRecover'
  | 'pumpFake';

/** Flat action record (no per-action allocations). Fields are interpreted per `kind`. */
export interface ActionState {
  kind: ActionKind;
  t: number;
  duration: number;
  moveId: DribbleMoveId | null;
  /** Moves: world-space forward direction (unit XZ). Layups/dunks: world-space finish spot. */
  dirX: number;
  dirZ: number;
  /** Lateral world direction for moves. */
  sideX: number;
  sideZ: number;
  shotType: ShotType | null;
  /** Ideal release time (seconds into the action). */
  releaseTime: number;
  released: boolean;
  /** Generic "already resolved" flag (steal contact, beat check, pass release). */
  resolved: boolean;
  targetId: number;
}

export interface PlayerStats {
  points: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  oreb: number;
  dreb: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  dunks: number;
}

export function emptyStats(): PlayerStats {
  return { points: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, oreb: 0, dreb: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, dunks: 0 };
}

export interface SimPlayer {
  /** Index in `Simulation.players`. */
  id: number;
  team: TeamIndex;
  /** Index within the team. */
  slot: number;
  defId: string;
  name: string;
  number: number;
  position: Position;
  archetype: ArchetypeId;
  attr: Attributes;
  mods: GameplayModifiers;
  tendencies: Tendencies;
  height: number;
  build: number;
  look: PlayerLook;
  /** Standing reach (fingertips) in meters. */
  reach: number;
  jumpHeight: number;

  /** Feet position; y > 0 while airborne. */
  pos: Vec3;
  prevPos: Vec3;
  vel: Vec2;
  vy: number;
  /** Gravity used for the current jump (jumps are authored by height and duration). */
  jumpG: number;
  airborne: boolean;
  facing: number;
  prevFacing: number;
  stamina: number;
  exhausted: boolean;
  /** Ball hand: 1 = right, -1 = left. */
  hand: 1 | -1;
  action: ActionState;
  prevButtons: number;
  sprinting: boolean;
  inStance: boolean;
  /** Post-move burst multiplier and remaining time. */
  boostMultiplier: number;
  boostTime: number;
  /** Time since the last dribble move ended (for chains and move-shots). */
  sinceMove: number;
  lastMoveShotStyle: 'stepback' | 'pullUp' | null;
  stealCooldown: number;
  /** >0 while calling for the ball. */
  callForBall: number;
  /** Shot assist: a tap starts the shot and it releases automatically (timing capped at "good"). */
  autoRelease: boolean;
  /** Seconds since this player last caught a pass (assist tracking). */
  sinceCatch: number;
  lastPasser: number;
  stats: PlayerStats;
}

export type BallPhase = 'held' | 'shot' | 'pass' | 'loose' | 'dead';
export type LooseReason = 'rebound' | 'deflection' | 'block' | 'fumble' | 'none';

export interface ShotInfo {
  shooter: number;
  team: TeamIndex;
  type: ShotType;
  points: number;
  pct: number;
  timing: TimingGrade;
  timingError: number;
  contest: number;
  distance: number;
  intendedMake: boolean;
  /** Teammate credited with an assist if this shot scores (-1 = none). */
  assist: number;
  /** Shot released while the team still had to clear the ball. */
  uncleared: boolean;
  /** Seconds since release. */
  t: number;
  blocked: boolean;
  /** Defenders that already had their block roll (bitmask by player id). */
  blockRolled: number;
  scored: boolean;
  touchedRim: boolean;
  /** Set once the shot has been resolved as a miss (rim/backboard contact or landing). */
  resolved: boolean;
}

export interface PassInfo {
  passer: number;
  target: number;
  type: 'chest' | 'bounce' | 'lob';
  t: number;
  duration: number;
  /** Defenders that already had their interception roll for this pass (bitmask by player id). */
  interceptRolled: number;
}

export interface BallState {
  phase: BallPhase;
  holder: number;
  pos: Vec3;
  prevPos: Vec3;
  vel: Vec3;
  lastTouch: number;
  lastTouchTeam: TeamIndex;
  /** Last player who held the ball (turnover attribution). */
  lastHolder: number;
  shot: ShotInfo | null;
  pass: PassInfo | null;
  looseReason: LooseReason;
  /** Seconds in the current phase. */
  phaseTime: number;
  /** Remaining seconds of net guidance after a make. */
  netTime: number;
  /** Seconds the ball has been resting/rolling on the floor. */
  restTime: number;
  /** Cosmetic dribble cycle 0..1 (deterministic, rendered by the view layer). */
  dribblePhase: number;
}

export type MatchPhase = 'check' | 'live' | 'dead' | 'final';

export interface MatchState {
  phase: MatchPhase;
  phaseTime: number;
  offense: TeamIndex;
  score: [number, number];
  gameClock: number | null;
  shotClock: number | null;
  needsClear: boolean;
  overtime: boolean;
  winner: TeamIndex | -1;
  /** Team receiving the ball at the next check. */
  nextOffense: TeamIndex;
  /** Why the ball is dead (for UI). */
  deadReason: DeadReason;
  /** Game clock expired; waiting for a shot in flight. */
  horn: boolean;
  tick: number;
}

export type DeadReason = 'none' | 'score' | 'outOfBounds' | 'shotClock' | 'clearViolation' | 'practiceReset';

/** Events emitted during a simulation step; consumed by stats, audio, VFX and UI. */
export type SimEvent =
  | { type: 'phase'; phase: MatchPhase; offense: TeamIndex }
  | { type: 'shotStart'; player: number; shotType: ShotType; releaseTime: number; usesMeter: boolean }
  | { type: 'pumpFake'; player: number }
  | {
      type: 'shotRelease';
      player: number;
      shotType: ShotType;
      pct: number;
      timing: TimingGrade;
      timingError: number;
      contest: number;
      distance: number;
      points: number;
    }
  | { type: 'score'; player: number; team: TeamIndex; points: number; shotType: ShotType; assist: number; counted: boolean }
  | { type: 'miss'; player: number }
  | { type: 'rim'; strength: number }
  | { type: 'backboard'; strength: number }
  | { type: 'floorBounce'; strength: number }
  | { type: 'net' }
  | { type: 'pass'; from: number; to: number; passType: PassInfo['type'] }
  | { type: 'catch'; player: number }
  | { type: 'steal'; by: number; from: number; kind: 'poke' | 'interception' }
  | { type: 'stealMiss'; by: number }
  /** A reach knocked the ball loose (possession not yet decided). */
  | { type: 'deflection'; by: number }
  | { type: 'block'; by: number; shooter: number }
  | { type: 'rebound'; player: number; offensive: boolean }
  | { type: 'looseBall'; player: number }
  | { type: 'dribbleMove'; player: number; move: DribbleMoveId }
  | { type: 'defenderBeaten'; player: number; defender: number; severity: number }
  | { type: 'jump'; player: number }
  | { type: 'possession'; team: TeamIndex }
  | { type: 'turnover'; player: number; team: TeamIndex; reason: 'steal' | 'outOfBounds' | 'shotClock' | 'clearViolation' | 'interception' }
  | { type: 'clear'; team: TeamIndex }
  | { type: 'dead'; reason: DeadReason }
  | { type: 'gameEnd'; winner: TeamIndex; score: [number, number] };

export type SimEventType = SimEvent['type'];
