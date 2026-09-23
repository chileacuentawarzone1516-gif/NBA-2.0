/** Match mode definitions consumed by the rules system and the app layer. */
export const MODE_IDS = ['practice', 'oneOnOne', 'threeOnThree'] as const;
export type ModeId = (typeof MODE_IDS)[number];

export interface ModeConfig {
  id: ModeId;
  teamSize: number;
  /** Game clock in seconds (null = untimed). */
  gameClock: number | null;
  /** Shot clock in seconds (null = disabled). */
  shotClock: number | null;
  /** First team to reach this score wins (null = disabled). */
  targetScore: number | null;
  pointsInside: number;
  pointsBeyondArc: number;
  /** Ball must be taken beyond the arc after a change of possession. */
  clearRule: boolean;
  /** Scoring team keeps possession (streetball "make it, take it"). */
  makeItTakeIt: boolean;
  /** Opponents present. */
  hasOpponents: boolean;
  /** Practice: every rebound/score returns the ball to the controlled team. */
  practice: boolean;
  /** Whether results grant progression. */
  grantsProgression: boolean;
}

export const MODES: Record<ModeId, ModeConfig> = {
  practice: {
    id: 'practice', teamSize: 1, gameClock: null, shotClock: null, targetScore: null,
    pointsInside: 2, pointsBeyondArc: 3, clearRule: false, makeItTakeIt: true,
    hasOpponents: false, practice: true, grantsProgression: false,
  },
  oneOnOne: {
    id: 'oneOnOne', teamSize: 1, gameClock: 180, shotClock: 14, targetScore: 15,
    pointsInside: 2, pointsBeyondArc: 3, clearRule: true, makeItTakeIt: false,
    hasOpponents: true, practice: false, grantsProgression: true,
  },
  threeOnThree: {
    id: 'threeOnThree', teamSize: 3, gameClock: 300, shotClock: 14, targetScore: 21,
    pointsInside: 2, pointsBeyondArc: 3, clearRule: true, makeItTakeIt: false,
    hasOpponents: true, practice: false, grantsProgression: true,
  },
};
