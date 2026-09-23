import type { TouchSettings } from '../data/controls';
import { Button } from '../sim/input';
import { h } from '../ui/dom';
import type { InputFrame, InputSource } from './InputController';

/**
 * Mobile touch controls designed for thumbs, not ported from a keyboard:
 * - Floating joystick: touch anywhere on the left side; the stick appears under the thumb.
 * - Right-hand action cluster with a large shoot button and contextual labels.
 * Multi-touch uses pointer capture per pointerId, so sliding off a button still releases it.
 */
type ActionId = 'shoot' | 'pass' | 'skill' | 'sprint';

/** Pointer capture can throw if the pointer is already gone; input must keep working regardless. */
function capturePointer(el: HTMLElement, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Without capture we still receive the release via the root's pointerup/cancel listeners.
  }
}
const ACTION_BUTTONS: Record<ActionId, number> = {
  shoot: Button.Shoot,
  pass: Button.Pass,
  skill: Button.Skill,
  sprint: Button.Sprint,
};

export class TouchControls implements InputSource {
  readonly root: HTMLElement;
  private readonly stickZone: HTMLElement;
  private readonly stickBase: HTMLElement;
  private readonly stickKnob: HTMLElement;
  private readonly buttons = new Map<ActionId, HTMLElement>();
  private readonly labels = new Map<ActionId, HTMLElement>();
  private stickPointer = -1;
  private originX = 0;
  private originY = 0;
  private stickX = 0;
  private stickY = 0;
  private readonly pressed = new Map<number, ActionId>();
  private enabled = true;
  private settings: TouchSettings;

  constructor(parent: HTMLElement, settings: TouchSettings) {
    this.settings = { ...settings };
    this.stickKnob = h('div', { class: 'stick-knob' });
    this.stickBase = h('div', { class: 'stick-base', attrs: { 'aria-hidden': 'true' } }, this.stickKnob);
    this.stickZone = h('div', { class: 'stick-zone', attrs: { 'aria-label': 'movement joystick' } }, this.stickBase);
    const cluster = h('div', { class: 'action-cluster' });
    for (const id of ['shoot', 'pass', 'skill', 'sprint'] as const) {
      const label = h('span', { class: 'action-label' });
      const button = h('div', { class: `action-btn action-${id}`, attrs: { role: 'button', 'aria-label': id } }, label);
      this.buttons.set(id, button);
      this.labels.set(id, label);
      cluster.append(button);
      button.addEventListener('pointerdown', (e) => this.onButtonDown(e, id));
    }
    this.root = h('div', { class: 'touch-controls' }, this.stickZone, cluster);
    parent.append(this.root);

    this.stickZone.addEventListener('pointerdown', this.onStickDown);
    this.root.addEventListener('pointermove', this.onPointerMove);
    this.root.addEventListener('pointerup', this.onPointerUp);
    this.root.addEventListener('pointercancel', this.onPointerUp);
    this.root.addEventListener('lostpointercapture', this.onPointerUp);
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.applySettings(settings);
  }

  applySettings(settings: TouchSettings): void {
    this.settings = { ...settings };
    this.root.style.setProperty('--stick-radius', `${settings.stickRadius}px`);
    this.root.style.setProperty('--btn-scale', String(settings.buttonScale));
  }

  /** Contextual labels; an empty label marks the action unavailable in this context. */
  setLabels(labels: Record<ActionId, string>): void {
    for (const [id, text] of Object.entries(labels) as Array<[ActionId, string]>) {
      const label = this.labels.get(id);
      if (!label || label.textContent === text) continue;
      label.textContent = text;
      const button = this.buttons.get(id);
      button?.classList.toggle('unavailable', text === '');
      button?.setAttribute('aria-disabled', String(text === ''));
    }
  }

  /** Hides an action entirely (e.g. PASS in modes without teammates). */
  setActionVisible(id: ActionId, visible: boolean): void {
    const button = this.buttons.get(id);
    if (button) button.hidden = !visible;
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  private readonly onStickDown = (e: PointerEvent): void => {
    if (!this.enabled || this.stickPointer !== -1) return;
    e.preventDefault();
    this.stickPointer = e.pointerId;
    capturePointer(this.stickZone, e.pointerId);
    const rect = this.root.getBoundingClientRect();
    // Keep the base fully on screen.
    const r = this.settings.stickRadius;
    this.originX = Math.max(r + 8, Math.min(e.clientX - rect.left, rect.width * 0.45));
    this.originY = Math.max(r + 8, Math.min(e.clientY - rect.top, rect.height - r - 8));
    this.stickBase.style.transform = `translate(${this.originX - r}px, ${this.originY - r}px)`;
    this.stickBase.classList.add('active');
    this.updateStick(e.clientX - rect.left, e.clientY - rect.top);
  };

  private onButtonDown(e: PointerEvent, id: ActionId): void {
    if (!this.enabled) return;
    e.preventDefault();
    e.stopPropagation();
    capturePointer(e.currentTarget as HTMLElement, e.pointerId);
    this.pressed.set(e.pointerId, id);
    this.buttons.get(id)?.classList.add('pressed');
    if (this.settings.haptics && typeof navigator.vibrate === 'function') navigator.vibrate(id === 'shoot' ? 12 : 8);
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.stickPointer) return;
    const rect = this.root.getBoundingClientRect();
    this.updateStick(e.clientX - rect.left, e.clientY - rect.top);
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId === this.stickPointer) {
      this.stickPointer = -1;
      this.stickX = 0;
      this.stickY = 0;
      this.stickBase.classList.remove('active');
      this.stickKnob.style.transform = 'translate(0px, 0px)';
    }
    const id = this.pressed.get(e.pointerId);
    if (id) {
      this.pressed.delete(e.pointerId);
      if (![...this.pressed.values()].includes(id)) this.buttons.get(id)?.classList.remove('pressed');
    }
  };

  private updateStick(x: number, y: number): void {
    const r = this.settings.stickRadius;
    let dx = x - this.originX;
    let dy = y - this.originY;
    const dist = Math.hypot(dx, dy);
    if (dist > r) {
      dx = (dx / dist) * r;
      dy = (dy / dist) * r;
    }
    this.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    const mag = Math.min(1, dist / r);
    const dz = this.settings.deadZone;
    if (mag < dz || dist < 1e-3) {
      this.stickX = 0;
      this.stickY = 0;
      return;
    }
    const scaled = Math.pow((mag - dz) / (1 - dz), this.settings.sensitivity);
    this.stickX = (dx / Math.hypot(dx, dy)) * scaled;
    this.stickY = (-dy / Math.hypot(dx, dy)) * scaled;
  }

  poll(frame: InputFrame): void {
    frame.stickX += this.stickX;
    frame.stickY += this.stickY;
    for (const id of this.pressed.values()) frame.buttons |= ACTION_BUTTONS[id];
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.pressed.clear();
      for (const b of this.buttons.values()) b.classList.remove('pressed');
      this.stickPointer = -1;
      this.stickX = 0;
      this.stickY = 0;
      this.stickBase.classList.remove('active');
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
