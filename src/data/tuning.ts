/**
 * Central gameplay tuning. Every balance-relevant number lives here so designers can
 * iterate without touching system code. Units: meters, seconds, ratings 25–99.
 */

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
export const GRAVITY = 9.81;

export const MOVEMENT = {
  playerRadius: 0.36,
  jogSpeed: 4.1,
  sprintSpeed: 6.6,
  /** Speed multiplier range driven by the speed rating (25 → min, 99 → max). */
  speedRatingRange: [0.84, 1.1] as const,
  withBallMultiplier: 0.93,
  /** Defensive stance lateral speed relative to jog. */
  stanceSpeedMultiplier: 0.95,
  acceleration: 15,
  accelerationRatingRange: [0.78, 1.2] as const,
  deceleration: 22,
  turnRate: 11,
  turnRateWithBall: 8.5,
  /** Stick magnitude below which input is treated as zero (sim-side safety; UI has its own dead zone). */
  inputDeadZone: 0.12,
  /** Players are clamped this far inside the playable bounds. */
  boundsMargin: 0.25,
  /** Collision push factor: how strongly strength differences resolve overlaps. */
  strengthPushBias: 0.35,
  /** Speed multiplier while the player is off balance (stumble). */
  stumbleSpeedMultiplier: 0.3,
  /** Speed multiplier while recovering from a missed steal reach. */
  reachRecoverySpeedMultiplier: 0.55,
} as const;

export const STAMINA = {
  max: 100,
  sprintDrainPerSecond: 7.5,
  stanceDrainPerSecond: 1.2,
  recoverIdlePerSecond: 9,
  recoverJogPerSecond: 3.5,
  /** Stamina rating scales drain: 25 → x1.25, 99 → x0.8. */
  drainRatingRange: [1.25, 0.8] as const,
  jumpCost: 4,
  shotCost: 1.5,
  stealCost: 2,
  /** Below this, fatigue penalties scale in linearly. */
  fatigueThreshold: 40,
  maxSpeedPenalty: 0.14,
  maxShotPenalty: 0.1,
  /** Hysteresis: exhausted players cannot sprint until they recover past `exhaustedRecover`. */
  exhaustedBelow: 8,
  exhaustedRecover: 25,
} as const;

export const BODY = {
  /** Standing reach as a fraction of height (fingertips). */
  reachRatio: 1.33,
  /** Vertical leap height range driven by the vertical rating. */
  jumpHeightRange: [0.45, 0.95] as const,
  jumpDuration: 0.62,
  /** Ball handling height while dribbling (for steal geometry). */
  ballCarryHeight: 0.9,
  /** Lateral offset of the ball from body center while dribbling. */
  ballSideOffset: 0.34,
  ballForwardOffset: 0.28,
} as const;

export const BALL = {
  radius: 0.121,
  floorRestitution: 0.8,
  /** Horizontal velocity retained after each floor bounce. */
  floorFriction: 0.86,
  rimRestitution: 0.58,
  backboardRestitution: 0.66,
  /** Rolling deceleration on the floor (m/s²). */
  rollingFriction: 1.4,
  /** Velocity multiplier applied per second while passing through the net. */
  netDrag: 0.08,
  /** Below this vertical speed a floor contact stops bouncing and the ball rolls. */
  restVerticalSpeed: 0.6,
  /** Max prediction horizon for rebound landing estimates. */
  predictionSeconds: 2.5,
} as const;

export type ShotType = 'jumper' | 'pullUp' | 'fade' | 'stepback' | 'close' | 'floater' | 'layup' | 'dunk';
export type TimingGrade = 'perfect' | 'good' | 'early' | 'late' | 'poor';

export interface ShotTypeTuning {
  /** Rating mix used for the base percentage. */
  ratings: Partial<Record<'midRange' | 'threePoint' | 'finishing' | 'dunk' | 'postScoring', number>>;
  /** Base make chance at rating 25 and 99 (open, good timing, rested, standing). */
  basePct: readonly [number, number];
  /** Seconds from button press to the ideal release (apex). */
  releaseTime: number;
  /** Additional percentage penalty. */
  typePenalty: number;
  /** How much contests hurt this shot type (multiplies the global contest penalty). */
  contestSensitivity: number;
  /** Whether this shot uses the timing meter. */
  usesMeter: boolean;
  /** Apex height above the higher of release/rim. */
  arcHeight: number;
}

export const SHOOTING = {
  types: {
    jumper: { ratings: { midRange: 1 }, basePct: [0.33, 0.63], releaseTime: 0.56, typePenalty: 0, contestSensitivity: 1, usesMeter: true, arcHeight: 1.45 },
    pullUp: { ratings: { midRange: 1 }, basePct: [0.3, 0.59], releaseTime: 0.52, typePenalty: 0.03, contestSensitivity: 1, usesMeter: true, arcHeight: 1.4 },
    fade: { ratings: { midRange: 0.7, postScoring: 0.3 }, basePct: [0.24, 0.52], releaseTime: 0.6, typePenalty: 0.05, contestSensitivity: 0.7, usesMeter: true, arcHeight: 1.55 },
    stepback: { ratings: { midRange: 1 }, basePct: [0.26, 0.55], releaseTime: 0.55, typePenalty: 0.03, contestSensitivity: 0.8, usesMeter: true, arcHeight: 1.45 },
    close: { ratings: { finishing: 0.5, postScoring: 0.5 }, basePct: [0.45, 0.74], releaseTime: 0.42, typePenalty: 0, contestSensitivity: 0.95, usesMeter: true, arcHeight: 0.9 },
    floater: { ratings: { finishing: 0.5, midRange: 0.5 }, basePct: [0.3, 0.58], releaseTime: 0.4, typePenalty: 0, contestSensitivity: 0.6, usesMeter: true, arcHeight: 1.6 },
    layup: { ratings: { finishing: 1 }, basePct: [0.5, 0.87], releaseTime: 0.55, typePenalty: 0, contestSensitivity: 1.1, usesMeter: false, arcHeight: 0.55 },
    dunk: { ratings: { dunk: 1 }, basePct: [0.8, 0.97], releaseTime: 0.6, typePenalty: 0, contestSensitivity: 0.9, usesMeter: false, arcHeight: 0.05 },
  } satisfies Record<ShotType, ShotTypeTuning>,
  /** Three-point attempts use the threePoint rating with these base percentages. */
  threeBasePct: [0.25, 0.5] as const,
  /** Percentage lost per meter beyond 4.5 m on mid-range shots. */
  midRangeFalloffPerMeter: 0.012,
  /** Percentage lost per meter beyond the arc on threes. */
  deepFalloffPerMeter: 0.055,
  /** Max percentage points lost to a full contest. */
  maxContestPenalty: 0.28,
  contest: {
    range: 2.1,
    fullContestDistance: 0.55,
    /** >1 softens loose contests: value = closeness^exponent. */
    falloffExponent: 1.35,
    /** Defenders behind the shooter contest at this fraction. */
    behindFactor: 0.35,
    jumpingBonus: 1.3,
    secondDefenderFactor: 0.35,
    /** Height advantage per meter scales contest ±. */
    heightFactorPerMeter: 0.6,
  },
  /** Timing windows (seconds from ideal release); widened by shotWindow modifier and rating. */
  timingWindows: { perfect: 0.034, good: 0.085, ok: 0.17 },
  /** Window width multiplier range from the relevant rating. */
  timingRatingRange: [0.8, 1.2] as const,
  timingBonus: { perfect: 0.25, good: 0.05, early: -0.1, late: -0.1, poor: -0.3 } satisfies Record<TimingGrade, number>,
  /** Penalty when the shooter is moving fast at release (off-balance). */
  movingPenalty: 0.07,
  movingSpeedThreshold: 2.4,
  minPct: 0.02,
  maxPct: 0.97,
  /** Max seconds a jumper can be held before auto-release. */
  maxHoldTime: 1.1,
  /** Distances that pick close shots / layups / dunks. */
  dunkRange: 2.3,
  layupRange: 3.1,
  closeRange: 2.6,
  floaterRange: [3.1, 5.2] as const,
  /** Minimum speed toward the hoop to trigger a driving finish. */
  driveSpeed: 2.6,
  /** Dunk eligibility: dunk + vertical/2 + height bonus must reach this. */
  dunkEligibility: 100,
  /** Aim-offset radius for intended makes / misses (rim-local meters). */
  makeAimRadius: 0.05,
  missAimRange: [0.27, 0.36] as const,
  airballAimRange: [0.6, 1.1] as const,
  /** Shots beyond this range are heaves. */
  maxRange: 13.5,
  /** Window after a stepback/fade move in which the shot inherits that type. */
  moveShotWindow: 0.45,
} as const;

export const PASSING = {
  chestSpeed: 11.5,
  bounceSpeed: 9.5,
  lobSpeed: 8,
  /** Passes longer than this become lobs over defenders (when the lane is blocked). */
  maxPassDistance: 20,
  catchRadius: 0.75,
  catchHeightRange: [0.2, 2.6] as const,
  /** Directional targeting: cone half-angle for stick-directed passes. */
  aimConeRadians: 1.1,
  interceptRadius: 0.55,
  /** Base interception chance when a defender's hands are in the lane. */
  interceptBase: 0.18,
  interceptRatingWeight: 0.45,
  passActionTime: 0.22,
  /** Seconds after catching during which a score credits an assist. */
  assistWindow: 3.2,
} as const;

export const DEFENSE = {
  stealDuration: 0.34,
  stealContactTime: 0.12,
  stealRange: 1.35,
  stealConeRadians: 1.25,
  stealBase: 0.17,
  stealRatingWeight: 0.005,
  /** Extra success chance when the ball is on the defender's side of the handler. */
  exposedHandBonus: 0.1,
  maxStealChance: 0.5,
  reachRecovery: 0.42,
  stealCooldown: 0.8,
  blockRangeHorizontal: 1.05,
  blockBase: 0.2,
  blockRatingWeight: 0.005,
  /** Standing (not jumping) defenders can only block finishes at the rim, at this factor. */
  standingBlockFactor: 0.3,
  /** Blocks are only possible while the ball is rising and within this time after release. */
  blockWindow: 0.32,
  goaltendHeightMargin: 0.1,
} as const;

export const REBOUND = {
  grabRadius: 0.62,
  grabRatingBonus: 0.25,
  /** Ball above this height cannot be grabbed unless jumping. */
  maxStandingGrabBuffer: 0.15,
  jumpGrabBonus: 1.35,
  boxOutBonus: 1.25,
  /** Players cannot grab a ball inside the rim cylinder (basket interference). */
  rimCylinderRadius: 0.5,
  /** Offensive boards are harder: multiplier on offensive rebound weights. */
  offensiveWeight: 0.85,
} as const;

export const DRIBBLE = {
  /** Base cadence of the dribble (bounces per second), scaled by movement speed. */
  bounceRateIdle: 1.9,
  bounceRateSprint: 3.1,
  /** Chance modifiers for unbalancing a defender. */
  beatBase: 0.1,
  beatRatingWeight: 0.006,
  beatCommittedBonus: 0.25,
  maxBeatChance: 0.6,
  stumbleDuration: [0.45, 0.9] as const,
  /** Moves triggered within this many seconds of the previous one cost extra stamina. */
  chainWindow: 0.6,
  chainStaminaMultiplier: 1.5,
  /** Max distance to a defender for a move to count as attacking him. */
  beatRange: 2.1,
} as const;

export const RULES = {
  /** Distance beyond the arc for the check-ball spot. */
  checkSpotOut: 8.4,
  checkFreezeSeconds: 1.1,
  deadBallSeconds: 1.6,
  /** Seconds to wait after the final horn for a shot already in the air. */
  pregameSeconds: 1.2,
} as const;
