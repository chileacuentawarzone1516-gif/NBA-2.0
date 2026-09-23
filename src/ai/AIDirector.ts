import { Rng } from '../core/rng';
import type { DifficultyProfile } from '../data/difficulty';
import { emptyInput, type PlayerInput } from '../sim/input';
import type { TeamIndex } from '../sim/types';
import type { World } from '../sim/world';
import { PlayerBrain } from './PlayerBrain';
import { TeamBrain } from './TeamBrain';

/**
 * Owns all AI for a match: one TeamBrain per team (tactics) and one PlayerBrain per
 * player (decisions + steering). Human-controlled players are skipped, so control can
 * be switched at runtime without rebuilding the AI.
 */
export class AIDirector {
  private readonly teams: [TeamBrain, TeamBrain] = [new TeamBrain(0), new TeamBrain(1)];
  private readonly brains: PlayerBrain[] = [];
  private readonly scratch: PlayerInput = emptyInput();

  constructor(world: World, difficulties: readonly [DifficultyProfile, DifficultyProfile], seed: number) {
    const rng = new Rng(seed ^ 0x5bd1e995);
    for (const p of world.players) {
      this.brains.push(new PlayerBrain(p.id, difficulties[p.team], new Rng(rng.int(0, 0x7fffffff))));
    }
  }

  team(index: TeamIndex): TeamBrain {
    return this.teams[index];
  }

  /**
   * Fills `inputs` for every AI-controlled player. `human` lists player ids whose input
   * comes from a person; their slots are left untouched.
   */
  update(world: World, dt: number, inputs: PlayerInput[], human: ReadonlySet<number>): void {
    this.teams[0].update(world, dt);
    this.teams[1].update(world, dt);
    for (const brain of this.brains) {
      if (human.has(brain.playerId)) continue;
      const player = world.players[brain.playerId];
      if (!player) continue;
      const out = inputs[brain.playerId] ?? this.scratch;
      brain.think(world, this.teams[player.team], out);
      inputs[brain.playerId] = out;
    }
  }
}
