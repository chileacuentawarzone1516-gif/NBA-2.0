import type { Rng } from '../core/rng';
import type { CourtBounds, Hoop } from '../data/court';
import type { ModeConfig } from '../data/modes';
import type { BallState, MatchState, SimEvent, SimPlayer } from './types';

/**
 * The simulation state as seen by systems. Systems are plain functions over a World
 * (no hidden globals), which keeps them unit-testable and server-portable.
 */
export interface World {
  readonly mode: ModeConfig;
  readonly hoop: Hoop;
  readonly bounds: CourtBounds;
  readonly rng: Rng;
  readonly players: SimPlayer[];
  readonly ball: BallState;
  readonly match: MatchState;
  readonly events: SimEvent[];
  /** Simulated seconds since the match started. */
  time: number;
}

export function emit(world: World, event: SimEvent): void {
  world.events.push(event);
}

export function teammates(world: World, player: SimPlayer): SimPlayer[] {
  return world.players.filter((p) => p.team === player.team && p.id !== player.id);
}

export function opponents(world: World, player: SimPlayer): SimPlayer[] {
  return world.players.filter((p) => p.team !== player.team);
}

export function ballHolder(world: World): SimPlayer | null {
  const { ball } = world;
  return ball.phase === 'held' && ball.holder >= 0 ? (world.players[ball.holder] ?? null) : null;
}
