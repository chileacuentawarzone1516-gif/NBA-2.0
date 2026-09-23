import type { PlayerInput } from '../sim/input';

/**
 * Device-agnostic input. Each source writes into a shared frame (stick in screen space,
 * +y = up/away from the camera; action buttons as a bitmask). The controller converts it
 * into a world-space PlayerInput relative to the current camera heading.
 */
export interface InputFrame {
  stickX: number;
  stickY: number;
  buttons: number;
  /** Edge-triggered UI actions. */
  pause: boolean;
  debug: boolean;
}

export interface InputSource {
  /** Merge this source's state into the frame. */
  poll(frame: InputFrame): void;
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

export class InputController {
  private readonly frame: InputFrame = { stickX: 0, stickY: 0, buttons: 0, pause: false, debug: false };
  private readonly sources: InputSource[] = [];
  private enabled = true;

  add(source: InputSource): void {
    this.sources.push(source);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    for (const s of this.sources) s.setEnabled(enabled);
  }

  /** Samples all sources. Returns the raw frame (for UI actions such as pause). */
  sample(): InputFrame {
    const f = this.frame;
    f.stickX = 0;
    f.stickY = 0;
    f.buttons = 0;
    f.pause = false;
    f.debug = false;
    if (!this.enabled) return f;
    for (const s of this.sources) s.poll(f);
    const mag = Math.hypot(f.stickX, f.stickY);
    if (mag > 1) {
      f.stickX /= mag;
      f.stickY /= mag;
    }
    return f;
  }

  /**
   * Converts the last sampled frame into a world-space command. `forwardX/Z` is the
   * camera's forward direction projected on the court.
   */
  toPlayerInput(forwardX: number, forwardZ: number, out: PlayerInput): PlayerInput {
    const f = this.frame;
    const len = Math.hypot(forwardX, forwardZ) || 1;
    const fx = forwardX / len;
    const fz = forwardZ / len;
    // Screen right in world space (camera looks along +forward, y up).
    const rx = -fz;
    const rz = fx;
    out.moveX = rx * f.stickX + fx * f.stickY;
    out.moveZ = rz * f.stickX + fz * f.stickY;
    out.buttons = f.buttons;
    out.passTarget = -1;
    return out;
  }

  dispose(): void {
    for (const s of this.sources) s.dispose();
    this.sources.length = 0;
  }
}

