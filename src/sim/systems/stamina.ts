import { lerp } from '../../core/math';
import { ratingT } from '../../data/attributes';
import { STAMINA } from '../../data/tuning';
import type { SimPlayer } from '../types';

/** Stamina model: continuous drain/recovery plus discrete action costs, with exhaustion hysteresis. */

export function staminaDrainScale(p: SimPlayer): number {
  const r = STAMINA.drainRatingRange;
  return lerp(r[0], r[1], ratingT(p.attr.stamina)) * p.mods.staminaDrain;
}

export function spendStamina(p: SimPlayer, amount: number): void {
  p.stamina = Math.max(0, p.stamina - amount * staminaDrainScale(p));
}

export function updateStamina(p: SimPlayer, dt: number): void {
  const speed = Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z);
  if (p.sprinting) {
    p.stamina -= STAMINA.sprintDrainPerSecond * staminaDrainScale(p) * dt;
  } else if (p.inStance && speed > 0.8) {
    p.stamina -= STAMINA.stanceDrainPerSecond * staminaDrainScale(p) * dt;
  } else if (!p.airborne && p.action.kind === 'none') {
    const recover = speed < 1.5 ? STAMINA.recoverIdlePerSecond : STAMINA.recoverJogPerSecond;
    p.stamina += recover * dt;
  }
  p.stamina = Math.max(0, Math.min(STAMINA.max, p.stamina));
  if (p.stamina <= STAMINA.exhaustedBelow) p.exhausted = true;
  else if (p.exhausted && p.stamina >= STAMINA.exhaustedRecover) p.exhausted = false;
}
