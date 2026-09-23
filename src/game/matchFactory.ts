import { AIDirector } from '../ai/AIDirector';
import { DIFFICULTIES, type DifficultyId } from '../data/difficulty';
import { MODES, type ModeId } from '../data/modes';
import { getPlayer, type PlayerDef } from '../data/players';
import type { SkillId } from '../data/skills';
import { getTeam } from '../data/teams';
import { emptyInput, type PlayerInput } from '../sim/input';
import type { RosterEntry } from '../sim/playerFactory';
import { Simulation } from '../sim/Simulation';

/**
 * Builds a ready-to-run match (simulation + AI + input buffers) from high-level choices.
 * Shared by the game client and headless tests so both exercise the exact same setup.
 */
export interface MatchConfig {
  mode: ModeId;
  seed: number;
  difficulty: DifficultyId;
  homeTeamId: string;
  awayTeamId: string;
  /** Optional explicit lineups (player ids); defaults to the first N roster players. */
  homeLineup?: readonly string[];
  awayLineup?: readonly string[];
  /** Replaces the first home player (e.g. the user's created player). */
  homeStar?: { def: PlayerDef; skills: readonly SkillId[] };
}

export interface Match {
  config: MatchConfig;
  sim: Simulation;
  ai: AIDirector;
  inputs: PlayerInput[];
}

function lineup(teamId: string, size: number, explicit?: readonly string[]): RosterEntry[] {
  const ids = explicit && explicit.length >= size ? explicit : getTeam(teamId).roster;
  return ids.slice(0, size).map((id) => ({ def: getPlayer(id) }));
}

export function createMatch(config: MatchConfig): Match {
  const mode = MODES[config.mode];
  const home = lineup(config.homeTeamId, mode.teamSize, config.homeLineup);
  if (config.homeStar) home[0] = { def: config.homeStar.def, skills: config.homeStar.skills };
  const away = mode.hasOpponents ? lineup(config.awayTeamId, mode.teamSize, config.awayLineup) : [];
  const sim = new Simulation({ mode, seed: config.seed, teams: [home, away] });
  const difficulty = DIFFICULTIES[config.difficulty];
  const ai = new AIDirector(sim, [difficulty, difficulty], config.seed);
  const inputs = sim.players.map(() => emptyInput());
  return { config, sim, ai, inputs };
}
