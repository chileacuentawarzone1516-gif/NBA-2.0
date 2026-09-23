/**
 * Gameplay modifiers granted by archetypes and skills. They are resolved once per
 * match into a flat multiplier set per player (see sim/playerFactory.ts), so systems
 * read a single number instead of branching on archetype or skill ids.
 */
export interface GameplayModifiers {
  /** Multiplies the width of the shot timing windows. */
  shotWindow: number;
  /** Multiplies the contest penalty applied to this player's jump shots. */
  contestPenalty: number;
  /** Multiplies the penalty from deep (beyond the arc) distance. */
  deepRangePenalty: number;
  /** Multiplies the contest penalty on layups/dunks (contact finishing). */
  finishingContact: number;
  /** Multiplies the chance of unbalancing a defender with a dribble move. */
  dribbleBeat: number;
  /** Multiplies steal success chance. */
  stealChance: number;
  /** Multiplies block success chance. */
  blockChance: number;
  /** Multiplies rebound contest weight. */
  reboundWeight: number;
  /** Multiplies stamina drain. */
  staminaDrain: number;
  /** Multiplies pass speed (and lowers interception exposure). */
  passSpeed: number;
  /** Multiplies the contest this player applies as a defender. */
  contestPower: number;
}

export const NEUTRAL_MODIFIERS: Readonly<GameplayModifiers> = Object.freeze({
  shotWindow: 1,
  contestPenalty: 1,
  deepRangePenalty: 1,
  finishingContact: 1,
  dribbleBeat: 1,
  stealChance: 1,
  blockChance: 1,
  reboundWeight: 1,
  staminaDrain: 1,
  passSpeed: 1,
  contestPower: 1,
});

export function combineModifiers(...parts: ReadonlyArray<Partial<GameplayModifiers>>): GameplayModifiers {
  const result: GameplayModifiers = { ...NEUTRAL_MODIFIERS };
  for (const part of parts) {
    for (const key of Object.keys(part) as Array<keyof GameplayModifiers>) {
      const value = part[key];
      if (typeof value === 'number') result[key] *= value;
    }
  }
  return result;
}
