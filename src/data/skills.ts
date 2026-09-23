import type { GameplayModifiers } from './modifiers';

/** Unlockable skills. Effects are expressed only as modifiers so systems stay skill-agnostic. */
export const SKILL_IDS = [
  'quickRelease',
  'deadeye',
  'deepRange',
  'ankleBreaker',
  'pickpocket',
  'rimWall',
  'glassCleaner',
  'powerFinisher',
  'tireless',
  'dimeDropper',
  'clampHands',
] as const;

export type SkillId = (typeof SKILL_IDS)[number];

export interface SkillDef {
  id: SkillId;
  /** Player level at which the skill becomes available. */
  unlockLevel: number;
  modifiers: Partial<GameplayModifiers>;
}

export const SKILLS: Record<SkillId, SkillDef> = {
  quickRelease: { id: 'quickRelease', unlockLevel: 2, modifiers: { shotWindow: 1.12 } },
  tireless: { id: 'tireless', unlockLevel: 3, modifiers: { staminaDrain: 0.85 } },
  pickpocket: { id: 'pickpocket', unlockLevel: 4, modifiers: { stealChance: 1.15 } },
  glassCleaner: { id: 'glassCleaner', unlockLevel: 5, modifiers: { reboundWeight: 1.12 } },
  ankleBreaker: { id: 'ankleBreaker', unlockLevel: 6, modifiers: { dribbleBeat: 1.2 } },
  dimeDropper: { id: 'dimeDropper', unlockLevel: 7, modifiers: { passSpeed: 1.1 } },
  deadeye: { id: 'deadeye', unlockLevel: 8, modifiers: { contestPenalty: 0.82 } },
  powerFinisher: { id: 'powerFinisher', unlockLevel: 9, modifiers: { finishingContact: 0.82 } },
  rimWall: { id: 'rimWall', unlockLevel: 10, modifiers: { blockChance: 1.18 } },
  clampHands: { id: 'clampHands', unlockLevel: 11, modifiers: { contestPower: 1.12 } },
  deepRange: { id: 'deepRange', unlockLevel: 12, modifiers: { deepRangePenalty: 0.7 } },
};

/** Maximum number of skills a player can equip at once. */
export const MAX_EQUIPPED_SKILLS = 3;
