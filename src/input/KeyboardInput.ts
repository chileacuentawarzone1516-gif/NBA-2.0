import { Button } from '../sim/input';
import type { InputFrame, InputSource } from './InputController';

/**
 * Keyboard bindings (desktop / testing):
 * WASD or arrows = move, Shift = sprint, Space/K = shoot, J = pass/switch,
 * L = dribble move/steal, I = jump, Esc/P = pause, ` = debug overlay.
 */
const BUTTON_KEYS: Record<string, number> = {
  ShiftLeft: Button.Sprint,
  ShiftRight: Button.Sprint,
  Space: Button.Shoot,
  KeyK: Button.Shoot,
  KeyJ: Button.Pass,
  KeyL: Button.Skill,
  KeyI: Button.Jump,
};

export class KeyboardInput implements InputSource {
  private readonly down = new Set<string>();
  private pausePressed = false;
  private debugPressed = false;
  private enabled = true;

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled) return;
    // Do not hijack typing in form fields.
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (!e.repeat) this.pausePressed = true;
      return;
    }
    if (e.code === 'Backquote') {
      if (!e.repeat) this.debugPressed = true;
      return;
    }
    if (e.code in BUTTON_KEYS || e.code.startsWith('Arrow') || ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
      e.preventDefault();
      this.down.add(e.code);
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private readonly onBlur = (): void => {
    this.down.clear();
  };

  poll(frame: InputFrame): void {
    const d = this.down;
    const x = (d.has('KeyD') || d.has('ArrowRight') ? 1 : 0) - (d.has('KeyA') || d.has('ArrowLeft') ? 1 : 0);
    const y = (d.has('KeyW') || d.has('ArrowUp') ? 1 : 0) - (d.has('KeyS') || d.has('ArrowDown') ? 1 : 0);
    if (x !== 0 || y !== 0) {
      const len = Math.hypot(x, y);
      frame.stickX += x / len;
      frame.stickY += y / len;
    }
    for (const code of d) frame.buttons |= BUTTON_KEYS[code] ?? 0;
    if (this.pausePressed) frame.pause = true;
    if (this.debugPressed) frame.debug = true;
    this.pausePressed = false;
    this.debugPressed = false;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.down.clear();
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}
