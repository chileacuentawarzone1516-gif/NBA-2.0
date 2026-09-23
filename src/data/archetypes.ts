import type { AttributeKey, Attributes, Position } from './attributes';
import type { GameplayModifiers } from './modifiers';

export const ARCHETYPE_IDS = [
  'playmaker',
  'shotCreator',
  'sharpshooter',
  'slasher',
  'lockdown',
  'rimProtector',
  'insideScorer',
  'stretchBig',
] as const;

export type ArchetypeId = (typeof ARCHETYPE_IDS)[number];

/** AI decision weights in [0,1]. Consumed by ai/* to give each archetype a recognizable playstyle. */
export interface Tendencies {
  shootThree: number;
  shootMid: number;
  drive: number;
  post: number;
  pass: number;
  dribbleMoves: number;
  crashBoards: number;
  stealGamble: number;
  helpDefense: number;
}

export interface ArchetypeDef {
  id: ArchetypeId;
  positions: readonly Position[];
  /** Starting attributes for a created player of this archetype (unlisted = 50). */
  template: Partial<Attributes>;
  /** Progression caps (unlisted = 85). */
  caps: Partial<Attributes>;
  /** Attributes this archetype upgrades most efficiently (1 point instead of 2). */
  focus: readonly AttributeKey[];
  tendencies: Tendencies;
  modifiers: Partial<GameplayModifiers>;
  /** Visual body profile used by the renderer (height meters, build 0 = slim, 1 = heavy). */
  body: { height: number; build: number };
}

export const ARCHETYPES: Record<ArchetypeId, ArchetypeDef> = {
  playmaker: {
    id: 'playmaker',
    positions: ['PG'],
    template: { speed: 72, acceleration: 74, ballHandle: 74, passing: 76, threePoint: 58, midRange: 58, finishing: 56, offensiveIQ: 70, steal: 58, perimeterDefense: 55, strength: 40, vertical: 55, dunk: 35, block: 32, interiorDefense: 35, postScoring: 35 },
    caps: { ballHandle: 97, passing: 98, speed: 94, acceleration: 95, offensiveIQ: 96, threePoint: 88, dunk: 70, block: 60, strength: 70, interiorDefense: 60 },
    focus: ['ballHandle', 'passing', 'offensiveIQ', 'speed'],
    tendencies: { shootThree: 0.45, shootMid: 0.4, drive: 0.55, post: 0.05, pass: 0.85, dribbleMoves: 0.7, crashBoards: 0.15, stealGamble: 0.5, helpDefense: 0.4 },
    modifiers: { passSpeed: 1.12, dribbleBeat: 1.1 },
    body: { height: 1.88, build: 0.2 },
  },
  shotCreator: {
    id: 'shotCreator',
    positions: ['PG', 'SG'],
    template: { speed: 68, acceleration: 70, ballHandle: 72, passing: 58, midRange: 70, threePoint: 64, finishing: 60, offensiveIQ: 66, perimeterDefense: 50, steal: 50, strength: 45, vertical: 60, dunk: 45, block: 35, interiorDefense: 38 },
    caps: { ballHandle: 96, midRange: 97, threePoint: 92, finishing: 90, speed: 92, dunk: 80, block: 62 },
    focus: ['ballHandle', 'midRange', 'threePoint'],
    tendencies: { shootThree: 0.55, shootMid: 0.75, drive: 0.5, post: 0.1, pass: 0.4, dribbleMoves: 0.85, crashBoards: 0.2, stealGamble: 0.35, helpDefense: 0.3 },
    modifiers: { dribbleBeat: 1.2, contestPenalty: 0.9 },
    body: { height: 1.93, build: 0.3 },
  },
  sharpshooter: {
    id: 'sharpshooter',
    positions: ['SG', 'SF'],
    template: { threePoint: 76, midRange: 70, speed: 64, acceleration: 62, ballHandle: 58, passing: 55, finishing: 50, offensiveIQ: 64, perimeterDefense: 52, steal: 48, strength: 42, vertical: 52, dunk: 38, block: 35, interiorDefense: 38 },
    caps: { threePoint: 99, midRange: 96, ballHandle: 85, speed: 88, dunk: 70, strength: 72, block: 60 },
    focus: ['threePoint', 'midRange'],
    tendencies: { shootThree: 0.9, shootMid: 0.55, drive: 0.25, post: 0.05, pass: 0.5, dribbleMoves: 0.35, crashBoards: 0.15, stealGamble: 0.3, helpDefense: 0.35 },
    modifiers: { shotWindow: 1.18, deepRangePenalty: 0.75 },
    body: { height: 1.96, build: 0.25 },
  },
  slasher: {
    id: 'slasher',
    positions: ['SG', 'SF'],
    template: { speed: 74, acceleration: 76, vertical: 76, finishing: 74, dunk: 70, ballHandle: 62, strength: 58, midRange: 52, threePoint: 45, passing: 52, perimeterDefense: 55, steal: 52, offensiveIQ: 60, block: 45, interiorDefense: 45 },
    caps: { finishing: 98, dunk: 98, vertical: 97, speed: 95, acceleration: 97, threePoint: 80, ballHandle: 88 },
    focus: ['finishing', 'dunk', 'vertical', 'acceleration'],
    tendencies: { shootThree: 0.2, shootMid: 0.35, drive: 0.9, post: 0.15, pass: 0.4, dribbleMoves: 0.6, crashBoards: 0.4, stealGamble: 0.45, helpDefense: 0.4 },
    modifiers: { finishingContact: 0.75 },
    body: { height: 1.98, build: 0.45 },
  },
  lockdown: {
    id: 'lockdown',
    positions: ['SG', 'SF'],
    template: { perimeterDefense: 78, steal: 72, defensiveIQ: 74, speed: 70, acceleration: 70, strength: 60, vertical: 62, interiorDefense: 55, block: 52, ballHandle: 52, passing: 50, midRange: 52, threePoint: 52, finishing: 55, dunk: 50, defensiveRebound: 55 },
    caps: { perimeterDefense: 99, steal: 97, defensiveIQ: 98, block: 82, interiorDefense: 85, threePoint: 82, ballHandle: 80 },
    focus: ['perimeterDefense', 'steal', 'defensiveIQ'],
    tendencies: { shootThree: 0.45, shootMid: 0.35, drive: 0.4, post: 0.1, pass: 0.55, dribbleMoves: 0.3, crashBoards: 0.3, stealGamble: 0.7, helpDefense: 0.8 },
    modifiers: { stealChance: 1.2, contestPower: 1.15 },
    body: { height: 1.98, build: 0.4 },
  },
  rimProtector: {
    id: 'rimProtector',
    positions: ['C', 'PF'],
    template: { block: 78, interiorDefense: 78, defensiveRebound: 76, offensiveRebound: 66, strength: 74, vertical: 66, defensiveIQ: 70, finishing: 60, dunk: 62, postScoring: 52, speed: 50, acceleration: 48, ballHandle: 35, passing: 45, midRange: 40, threePoint: 30, perimeterDefense: 50, steal: 42 },
    caps: { block: 99, interiorDefense: 99, defensiveRebound: 99, strength: 97, threePoint: 60, ballHandle: 62, speed: 75 },
    focus: ['block', 'interiorDefense', 'defensiveRebound', 'strength'],
    tendencies: { shootThree: 0.02, shootMid: 0.15, drive: 0.3, post: 0.6, pass: 0.45, dribbleMoves: 0.05, crashBoards: 0.9, stealGamble: 0.2, helpDefense: 0.95 },
    modifiers: { blockChance: 1.25, reboundWeight: 1.1 },
    body: { height: 2.13, build: 0.85 },
  },
  insideScorer: {
    id: 'insideScorer',
    positions: ['PF', 'C'],
    template: { postScoring: 76, finishing: 74, strength: 76, dunk: 68, offensiveRebound: 72, defensiveRebound: 66, vertical: 60, midRange: 50, threePoint: 32, ballHandle: 42, passing: 50, speed: 52, acceleration: 50, interiorDefense: 60, block: 58, perimeterDefense: 45, steal: 45 },
    caps: { postScoring: 99, finishing: 98, strength: 99, dunk: 96, offensiveRebound: 98, threePoint: 65, speed: 78 },
    focus: ['postScoring', 'finishing', 'strength', 'offensiveRebound'],
    tendencies: { shootThree: 0.05, shootMid: 0.3, drive: 0.6, post: 0.9, pass: 0.35, dribbleMoves: 0.15, crashBoards: 0.85, stealGamble: 0.25, helpDefense: 0.6 },
    modifiers: { finishingContact: 0.8, reboundWeight: 1.08 },
    body: { height: 2.06, build: 0.9 },
  },
  stretchBig: {
    id: 'stretchBig',
    positions: ['PF', 'C'],
    template: { threePoint: 70, midRange: 68, defensiveRebound: 66, interiorDefense: 60, block: 58, strength: 62, vertical: 55, finishing: 58, dunk: 52, postScoring: 55, ballHandle: 46, passing: 55, speed: 56, acceleration: 54, perimeterDefense: 50, steal: 45, offensiveRebound: 52 },
    caps: { threePoint: 95, midRange: 95, defensiveRebound: 92, block: 88, ballHandle: 72, speed: 80 },
    focus: ['threePoint', 'midRange', 'defensiveRebound'],
    tendencies: { shootThree: 0.75, shootMid: 0.5, drive: 0.3, post: 0.35, pass: 0.5, dribbleMoves: 0.15, crashBoards: 0.5, stealGamble: 0.25, helpDefense: 0.6 },
    modifiers: { deepRangePenalty: 0.85, shotWindow: 1.08 },
    body: { height: 2.08, build: 0.6 },
  },
};

export function archetypeCap(archetype: ArchetypeId, key: AttributeKey): number {
  return ARCHETYPES[archetype].caps[key] ?? 85;
}
