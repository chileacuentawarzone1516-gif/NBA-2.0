/**
 * AI difficulty profiles. Difficulty changes perception, decision quality and execution
 * consistency — never raw player attributes.
 */
export const DIFFICULTY_IDS = ['rookie', 'pro', 'allStar', 'legend'] as const;
export type DifficultyId = (typeof DIFFICULTY_IDS)[number];

export interface DifficultyProfile {
  id: DifficultyId;
  /** Ticks between tactical decisions (lower = faster reactions). */
  decisionTicks: number;
  /** Reaction delay (seconds) for on-ball defensive adjustments. */
  defenseReaction: number;
  /** Standard deviation of release timing error (seconds). */
  shotTimingSigma: number;
  /** Minimum expected points to take a shot when not under clock pressure. */
  shotSelectivity: number;
  /** 0..1 how often defenders correctly help and recover. */
  helpDiscipline: number;
  /** 0..1 contest/block discipline (jumping at the right time). */
  contestDiscipline: number;
  /** Scales steal attempt frequency (combined with player tendencies). */
  stealAggression: number;
  /** Probability of reading a pass lane / open teammate correctly. */
  passVision: number;
  /** Positioning error (meters) applied to defensive target spots. */
  positionNoise: number;
  /** Seconds of defender closeout the shooter anticipates when judging a shot (0 = none). */
  closeoutAnticipation: number;
}

export const DIFFICULTIES: Record<DifficultyId, DifficultyProfile> = {
  rookie: { id: 'rookie', decisionTicks: 18, defenseReaction: 0.32, shotTimingSigma: 0.1, shotSelectivity: 0.72, helpDiscipline: 0.35, contestDiscipline: 0.4, stealAggression: 0.5, passVision: 0.5, positionNoise: 0.55, closeoutAnticipation: 0.1 },
  pro: { id: 'pro', decisionTicks: 12, defenseReaction: 0.22, shotTimingSigma: 0.07, shotSelectivity: 0.85, helpDiscipline: 0.6, contestDiscipline: 0.62, stealAggression: 0.75, passVision: 0.7, positionNoise: 0.3, closeoutAnticipation: 0.3 },
  allStar: { id: 'allStar', decisionTicks: 8, defenseReaction: 0.15, shotTimingSigma: 0.05, shotSelectivity: 0.95, helpDiscipline: 0.8, contestDiscipline: 0.8, stealAggression: 0.9, passVision: 0.85, positionNoise: 0.15, closeoutAnticipation: 0.42 },
  legend: { id: 'legend', decisionTicks: 5, defenseReaction: 0.1, shotTimingSigma: 0.036, shotSelectivity: 1.02, helpDiscipline: 0.93, contestDiscipline: 0.92, stealAggression: 1, passVision: 0.95, positionNoise: 0.06, closeoutAnticipation: 0.5 },
};
