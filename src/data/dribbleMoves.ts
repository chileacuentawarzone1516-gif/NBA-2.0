import type { ArchetypeId } from './archetypes';

/**
 * Data-driven dribble move catalogue. The dribbling system selects a move from the
 * stick direction (relative to the handler's facing and ball hand) and executes it
 * purely from these parameters, so new moves are added here without code changes.
 */
export type MoveTrigger =
  /** Stick neutral. */
  | 'neutral'
  /** Stick toward the ball-free hand side. */
  | 'offHandSide'
  /** Stick toward the ball-hand side. */
  | 'ballHandSide'
  | 'back'
  | 'forward'
  | 'backDiagonal'
  | 'forwardDiagonal';

export const DRIBBLE_MOVE_IDS = [
  'hesitation',
  'crossover',
  'sideEscape',
  'betweenLegs',
  'behindBack',
  'stepback',
  'burst',
] as const;

export type DribbleMoveId = (typeof DRIBBLE_MOVE_IDS)[number];

export interface DribbleMoveDef {
  id: DribbleMoveId;
  trigger: MoveTrigger;
  duration: number;
  staminaCost: number;
  /** Minimum ball-handle rating; below it the move downgrades to `fallback`. */
  minHandle: number;
  fallback: DribbleMoveId | null;
  /**
   * Displacement over the move in handler-local space (meters): +lateral = toward the
   * stick side, +forward = the facing direction. Applied as a velocity profile.
   */
  lateral: number;
  forward: number;
  /** Movement speed multiplier after the move's displacement phase (burst effect). */
  exitSpeedMultiplier: number;
  /** Seconds the exit speed boost lasts. */
  exitDuration: number;
  switchesHand: boolean;
  /** Steal vulnerability multiplier while the move is in progress. */
  exposure: number;
  /** Relative power to unbalance the on-ball defender. */
  beatPower: number;
  /** Fraction of the duration at which the defender check happens. */
  beatMoment: number;
  /** Shot type inherited by a shot started right after this move. */
  shotStyle: 'stepback' | 'pullUp' | null;
  archetypeAffinity: Partial<Record<ArchetypeId, number>>;
}

export const DRIBBLE_MOVES: Record<DribbleMoveId, DribbleMoveDef> = {
  hesitation: {
    id: 'hesitation', trigger: 'neutral', duration: 0.42, staminaCost: 2.5, minHandle: 25, fallback: null,
    lateral: 0, forward: -0.1, exitSpeedMultiplier: 1.28, exitDuration: 0.45, switchesHand: false,
    exposure: 1.0, beatPower: 0.8, beatMoment: 0.55, shotStyle: 'pullUp',
    archetypeAffinity: { playmaker: 1.15, shotCreator: 1.1 },
  },
  crossover: {
    id: 'crossover', trigger: 'offHandSide', duration: 0.36, staminaCost: 3.5, minHandle: 25, fallback: null,
    lateral: 1.05, forward: 0.25, exitSpeedMultiplier: 1.2, exitDuration: 0.4, switchesHand: true,
    exposure: 1.35, beatPower: 1.1, beatMoment: 0.6, shotStyle: 'pullUp',
    archetypeAffinity: { playmaker: 1.1, shotCreator: 1.2, slasher: 1.05 },
  },
  sideEscape: {
    id: 'sideEscape', trigger: 'ballHandSide', duration: 0.34, staminaCost: 3, minHandle: 25, fallback: null,
    lateral: 1.0, forward: -0.1, exitSpeedMultiplier: 1.05, exitDuration: 0.25, switchesHand: false,
    exposure: 0.8, beatPower: 0.7, beatMoment: 0.55, shotStyle: 'pullUp',
    archetypeAffinity: { sharpshooter: 1.2, stretchBig: 1.1 },
  },
  betweenLegs: {
    id: 'betweenLegs', trigger: 'forwardDiagonal', duration: 0.4, staminaCost: 4, minHandle: 60, fallback: 'crossover',
    lateral: 0.7, forward: 0.55, exitSpeedMultiplier: 1.25, exitDuration: 0.45, switchesHand: true,
    exposure: 0.7, beatPower: 1.2, beatMoment: 0.6, shotStyle: 'pullUp',
    archetypeAffinity: { shotCreator: 1.2, playmaker: 1.15 },
  },
  behindBack: {
    id: 'behindBack', trigger: 'backDiagonal', duration: 0.44, staminaCost: 4.5, minHandle: 68, fallback: 'crossover',
    lateral: 0.95, forward: -0.25, exitSpeedMultiplier: 1.22, exitDuration: 0.4, switchesHand: true,
    exposure: 0.55, beatPower: 1.3, beatMoment: 0.62, shotStyle: 'pullUp',
    archetypeAffinity: { playmaker: 1.2, shotCreator: 1.25 },
  },
  stepback: {
    id: 'stepback', trigger: 'back', duration: 0.4, staminaCost: 4, minHandle: 55, fallback: 'hesitation',
    lateral: 0, forward: -1.25, exitSpeedMultiplier: 1.0, exitDuration: 0, switchesHand: false,
    exposure: 0.9, beatPower: 0.9, beatMoment: 0.7, shotStyle: 'stepback',
    archetypeAffinity: { shotCreator: 1.3, sharpshooter: 1.2 },
  },
  burst: {
    id: 'burst', trigger: 'forward', duration: 0.3, staminaCost: 4.5, minHandle: 25, fallback: null,
    lateral: 0, forward: 1.1, exitSpeedMultiplier: 1.32, exitDuration: 0.55, switchesHand: false,
    exposure: 1.1, beatPower: 1.0, beatMoment: 0.5, shotStyle: null,
    archetypeAffinity: { slasher: 1.3, playmaker: 1.05 },
  },
};
