/**
 * Player attribute model. Ratings are integers 25–99.
 * Attributes feed gameplay systems directly (see sim/systems/*); the overall rating
 * is a presentation/matchmaking summary weighted by position.
 */

export const ATTRIBUTE_KEYS = [
  // Physical
  'speed',
  'acceleration',
  'strength',
  'vertical',
  'stamina',
  // Offense
  'ballHandle',
  'passing',
  'midRange',
  'threePoint',
  'finishing',
  'dunk',
  'postScoring',
  // Defense
  'perimeterDefense',
  'interiorDefense',
  'steal',
  'block',
  // Rebounding
  'offensiveRebound',
  'defensiveRebound',
  // Mental
  'offensiveIQ',
  'defensiveIQ',
] as const;

export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];
export type Attributes = Record<AttributeKey, number>;

export const ATTRIBUTE_GROUPS: Record<'physical' | 'offense' | 'defense' | 'rebounding' | 'mental', readonly AttributeKey[]> = {
  physical: ['speed', 'acceleration', 'strength', 'vertical', 'stamina'],
  offense: ['ballHandle', 'passing', 'midRange', 'threePoint', 'finishing', 'dunk', 'postScoring'],
  defense: ['perimeterDefense', 'interiorDefense', 'steal', 'block'],
  rebounding: ['offensiveRebound', 'defensiveRebound'],
  mental: ['offensiveIQ', 'defensiveIQ'],
};

export const RATING_MIN = 25;
export const RATING_MAX = 99;

export type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C';
export const POSITIONS: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

/** Relative weight of each attribute in the overall rating per position. Unlisted keys weigh 1. */
const OVERALL_WEIGHTS: Record<Position, Partial<Record<AttributeKey, number>>> = {
  PG: { ballHandle: 3, passing: 3, threePoint: 2, speed: 2, acceleration: 2, perimeterDefense: 1.5, offensiveIQ: 2, steal: 1.5, postScoring: 0.3, block: 0.3, interiorDefense: 0.4, offensiveRebound: 0.4, strength: 0.5 },
  SG: { threePoint: 3, midRange: 2.5, ballHandle: 2, speed: 1.5, perimeterDefense: 2, offensiveIQ: 1.5, steal: 1.3, postScoring: 0.4, block: 0.4, interiorDefense: 0.5, offensiveRebound: 0.5 },
  SF: { finishing: 2, midRange: 2, threePoint: 2, perimeterDefense: 2, vertical: 1.5, dunk: 1.5, speed: 1.3, strength: 1.2 },
  PF: { finishing: 2, postScoring: 2, strength: 2, interiorDefense: 2, defensiveRebound: 2.5, offensiveRebound: 2, block: 1.5, ballHandle: 0.6, passing: 0.8, threePoint: 0.8 },
  C: { interiorDefense: 3, block: 3, defensiveRebound: 3, offensiveRebound: 2.5, strength: 2.5, postScoring: 2, finishing: 2, ballHandle: 0.3, passing: 0.6, threePoint: 0.4, speed: 0.6, steal: 0.6 },
};

export function clampRating(value: number): number {
  return Math.max(RATING_MIN, Math.min(RATING_MAX, Math.round(value)));
}

/**
 * Weighted mean mapped with a small stretch so elite specialists read as elite
 * (a 99 shooter with average defense should not look average).
 */
export function computeOverall(attributes: Attributes, position: Position): number {
  const weights = OVERALL_WEIGHTS[position];
  let total = 0;
  let weightSum = 0;
  let best = 0;
  for (const key of ATTRIBUTE_KEYS) {
    const w = weights[key] ?? 1;
    total += attributes[key] * w;
    weightSum += w;
    if (w >= 2) best = Math.max(best, attributes[key]);
  }
  const mean = total / weightSum;
  return clampRating(mean * 0.88 + best * 0.14);
}

export function makeAttributes(fill: number, overrides: Partial<Attributes> = {}): Attributes {
  const attributes = {} as Attributes;
  for (const key of ATTRIBUTE_KEYS) attributes[key] = clampRating(overrides[key] ?? fill);
  return attributes;
}

/** Normalizes a rating to [0,1] across the valid range. */
export function ratingT(value: number): number {
  return Math.max(0, Math.min(1, (value - RATING_MIN) / (RATING_MAX - RATING_MIN)));
}
