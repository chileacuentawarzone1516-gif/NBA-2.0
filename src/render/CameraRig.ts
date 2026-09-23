import { Vector3, type PerspectiveCamera } from 'three';
import { clamp, damp, lerp } from '../core/math';
import { DEFAULT_CAMERA, type CameraSettings } from '../data/controls';
import type { Hoop } from '../data/court';

/**
 * Basketball camera. In play it frames the half court from a raised baseline-to-hoop
 * view, tracking a focus point between the ball and the rim with critically damped
 * smoothing (no jitter at any frame rate). It also offers a slow showcase orbit for menus.
 */
export class CameraRig {
  private readonly position = new Vector3(0, 8, -6);
  private readonly look = new Vector3(0, 1, 8);
  private readonly desiredPosition = new Vector3();
  private readonly desiredLook = new Vector3();
  private shake = 0;
  private shakeTime = 0;
  private orbitAngle = 0;
  settings: CameraSettings = { ...DEFAULT_CAMERA };

  constructor(private readonly camera: PerspectiveCamera) {}

  /** Snap immediately (e.g. at match start) instead of blending. */
  snap(focusX: number, focusZ: number, hoop: Hoop): void {
    this.computeDesired(focusX, focusZ, hoop);
    this.position.copy(this.desiredPosition);
    this.look.copy(this.desiredLook);
    this.apply(0);
  }

  addShake(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  follow(focusX: number, focusZ: number, hoop: Hoop, dt: number): void {
    this.computeDesired(focusX, focusZ, hoop);
    const kp = 1 - Math.exp(-3.2 * dt);
    const kl = 1 - Math.exp(-5 * dt);
    this.position.lerp(this.desiredPosition, kp);
    this.look.lerp(this.desiredLook, kl);
    this.apply(dt);
  }

  /** Slow orbit around center court for the menu backdrop. */
  orbit(dt: number): void {
    this.orbitAngle += dt * 0.06;
    const r = 17;
    this.position.set(Math.sin(this.orbitAngle) * r, 6.5, Math.cos(this.orbitAngle) * r * 0.9);
    this.look.set(0, 1.2, 0);
    this.apply(dt);
  }

  private computeDesired(focusX: number, focusZ: number, hoop: Hoop): void {
    const { height, distance } = this.settings;
    // Look between the action and the rim so the basket stays framed.
    const lookZ = lerp(focusZ, hoop.z, 0.38);
    const lookX = focusX * 0.75;
    this.desiredLook.set(lookX, 1.3, lookZ);
    const camZ = clamp(lookZ - hoop.dir * distance, -6, 8);
    this.desiredPosition.set(lookX * 0.6, height, camZ);
  }

  private apply(dt: number): void {
    this.camera.position.copy(this.position);
    if (this.shake > 0.001) {
      this.shakeTime += dt * 40;
      this.camera.position.x += Math.sin(this.shakeTime * 1.3) * this.shake;
      this.camera.position.y += Math.cos(this.shakeTime * 1.7) * this.shake;
      this.shake = damp(this.shake, 0, 6, dt);
    }
    this.camera.lookAt(this.look);
  }
}
