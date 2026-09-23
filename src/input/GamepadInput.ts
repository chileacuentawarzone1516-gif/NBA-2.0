import { Button } from '../sim/input';
import type { InputFrame, InputSource } from './InputController';

/** Standard-mapping gamepads: left stick move, A shoot, X pass, B move/steal, Y jump, RT/RB sprint, Start pause. */
const DEAD_ZONE = 0.18;

export class GamepadInput implements InputSource {
  private enabled = true;
  private startWasDown = false;

  poll(frame: InputFrame): void {
    if (!this.enabled || typeof navigator.getGamepads !== 'function') return;
    for (const pad of navigator.getGamepads()) {
      if (!pad || !pad.connected) continue;
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      const mag = Math.hypot(ax, ay);
      if (mag > DEAD_ZONE) {
        const scaled = Math.min(1, (mag - DEAD_ZONE) / (1 - DEAD_ZONE));
        frame.stickX += (ax / mag) * scaled;
        frame.stickY += (-ay / mag) * scaled;
      }
      const b = (i: number): boolean => Boolean(pad.buttons[i]?.pressed);
      if (b(0)) frame.buttons |= Button.Shoot;
      if (b(2)) frame.buttons |= Button.Pass;
      if (b(1)) frame.buttons |= Button.Skill;
      if (b(3)) frame.buttons |= Button.Jump;
      if (b(5) || b(7)) frame.buttons |= Button.Sprint;
      const start = b(9);
      if (start && !this.startWasDown) frame.pause = true;
      this.startWasDown = start;
      break; // first connected pad only
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  dispose(): void {}
}
