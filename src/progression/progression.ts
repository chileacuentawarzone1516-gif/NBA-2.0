import { ARCHETYPES, archetypeCap, type ArchetypeId } from '../data/archetypes';
import { makeAttributes, type AttributeKey } from '../data/attributes';
import type { DifficultyId } from '../data/difficulty';
import type { ModeId } from '../data/modes';
import type { PlayerDef } from '../data/players';
import { SKILL_IDS, SKILLS, type SkillId } from '../data/skills';
import { hashSeed } from '../core/rng';
import type { PlayerStats } from '../sim/types';
import type { MyPlayerSave } from '../save/schema';

/**
 * Progression rules as pure functions (no storage, no UI). They run locally today and
 * are designed to move unchanged to an authoritative server: never trust a client for
 * XP/progress in online modes — the server should recompute rewards from match events.
 */

export const MAX_LEVEL = 40;
export const POINTS_PER_LEVEL = 3;
export const MAX_MATCH_XP = 650;

export const PROGRESSION_REWARDS = {
  base: 60,
  win: 70,
  perPoint: 4,
  perRebound: 5,
  perAssist: 6,
  perSteal: 8,
  perBlock: 8,
  perTurnover: -2,
  difficulty: { rookie: 0.8, pro: 1, allStar: 1.25, legend: 1.5 } satisfies Record<DifficultyId, number>,
  mode: { practice: 0, oneOnOne: 1, threeOnThree: 1.1 } satisfies Record<ModeId, number>,
} as const;

/** XP needed to advance from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return Math.round(240 * Math.pow(level, 1.22));
}

export function matchXp(stats: PlayerStats, won: boolean, difficulty: DifficultyId, mode: ModeId): number {
  const r = PROGRESSION_REWARDS;
  const raw =
    r.base +
    (won ? r.win : 0) +
    stats.points * r.perPoint +
    (stats.oreb + stats.dreb) * r.perRebound +
    stats.assists * r.perAssist +
    stats.steals * r.perSteal +
    stats.blocks * r.perBlock +
    stats.turnovers * r.perTurnover;
  const scaled = Math.max(0, raw) * r.difficulty[difficulty] * r.mode[mode];
  return Math.min(MAX_MATCH_XP, Math.round(scaled));
}

export interface LevelResult {
  player: MyPlayerSave;
  levelsGained: number;
  newSkills: SkillId[];
}

export function applyXp(player: MyPlayerSave, xp: number): LevelResult {
  const next: MyPlayerSave = { ...player, attributes: { ...player.attributes }, equippedSkills: [...player.equippedSkills] };
  next.xp += Math.max(0, Math.round(xp));
  let levelsGained = 0;
  while (next.level < MAX_LEVEL && next.xp >= xpToNext(next.level)) {
    next.xp -= xpToNext(next.level);
    next.level++;
    next.upgradePoints += POINTS_PER_LEVEL;
    levelsGained++;
  }
  if (next.level >= MAX_LEVEL) next.xp = 0;
  const newSkills = SKILL_IDS.filter((id) => {
    const unlock = SKILLS[id].unlockLevel;
    return unlock > player.level && unlock <= next.level;
  });
  return { player: next, levelsGained, newSkills };
}

/** Upgrade cost in points: archetype focus attributes are cheaper. */
export function upgradeCost(archetype: ArchetypeId, key: AttributeKey): number {
  return ARCHETYPES[archetype].focus.includes(key) ? 1 : 2;
}

export function canUpgrade(player: MyPlayerSave, key: AttributeKey): boolean {
  return player.attributes[key] < archetypeCap(player.archetype, key) && player.upgradePoints >= upgradeCost(player.archetype, key);
}

export function upgradeAttribute(player: MyPlayerSave, key: AttributeKey): MyPlayerSave {
  if (!canUpgrade(player, key)) return player;
  return {
    ...player,
    upgradePoints: player.upgradePoints - upgradeCost(player.archetype, key),
    attributes: { ...player.attributes, [key]: player.attributes[key] + 1 },
  };
}

export function isSkillUnlocked(player: MyPlayerSave, skill: SkillId): boolean {
  return player.level >= SKILLS[skill].unlockLevel;
}

export function createMyPlayer(name: string, archetype: ArchetypeId): MyPlayerSave {
  const def = ARCHETYPES[archetype];
  const attributes = makeAttributes(50, def.template);
  const seed = hashSeed(name + archetype);
  return {
    name,
    archetype,
    position: def.positions[0] ?? 'SF',
    number: seed % 100,
    level: 1,
    xp: 0,
    upgradePoints: 0,
    attributes,
    equippedSkills: [],
    skinTone: seed % 6,
    hairStyle: (seed >> 3) % 4,
  };
}

/** Converts the saved created player into a roster definition for matches. */
export function myPlayerDef(player: MyPlayerSave): PlayerDef {
  const body = ARCHETYPES[player.archetype].body;
  const parts = player.name.split(' ');
  return {
    id: 'my-player',
    firstName: parts.length > 1 ? parts[0]! : '',
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : player.name,
    number: player.number,
    position: player.position,
    archetype: player.archetype,
    height: body.height,
    build: body.build,
    attributes: { ...player.attributes },
    look: { skinTone: player.skinTone, hairStyle: player.hairStyle },
  };
}
