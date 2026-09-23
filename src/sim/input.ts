/**
 * Per-tick player command. Humans and AI produce the same structure, which keeps the
 * simulation fair and makes inputs trivially serializable for replays and netcode.
 */

export const Button = {
  Sprint: 1 << 0,
  /** Shoot (hold/release) on offense with the ball; jump/contest/block otherwise. */
  Shoot: 1 << 1,
  /** Pass with the ball; call for the ball on offense; (switch is handled by the app layer). */
  Pass: 1 << 2,
  /** Dribble move with the ball; steal attempt on defense. */
  Skill: 1 << 3,
  /** Explicit jump (rebound/block) independent of context. */
  Jump: 1 << 4,
} as const;

export type ButtonMask = number;

export interface PlayerInput {
  /** World-space movement intent on the court plane, magnitude ≤ 1. */
  moveX: number;
  moveZ: number;
  buttons: ButtonMask;
  /** Explicit pass receiver (AI). -1 = choose from stick direction. */
  passTarget: number;
}

export function emptyInput(): PlayerInput {
  return { moveX: 0, moveZ: 0, buttons: 0, passTarget: -1 };
}

export function isDown(input: PlayerInput, button: number): boolean {
  return (input.buttons & button) !== 0;
}

export function wasPressed(input: PlayerInput, previousButtons: ButtonMask, button: number): boolean {
  return (input.buttons & button) !== 0 && (previousButtons & button) === 0;
}

export function wasReleased(input: PlayerInput, previousButtons: ButtonMask, button: number): boolean {
  return (input.buttons & button) === 0 && (previousButtons & button) !== 0;
}

/** Quantizes an input to the precision a network packet would carry (for determinism tests). */
export function quantizeInput(input: PlayerInput): PlayerInput {
  const q = (v: number): number => Math.round(Math.max(-1, Math.min(1, v)) * 127) / 127;
  return { moveX: q(input.moveX), moveZ: q(input.moveZ), buttons: input.buttons & 0xff, passTarget: input.passTarget };
}
