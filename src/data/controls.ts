/** Player-adjustable control and camera settings (defaults live in data so save/UI/input share them). */
export interface TouchSettings {
  /** Joystick radius in CSS pixels. */
  stickRadius: number;
  /** Normalized dead zone (0..0.5). */
  deadZone: number;
  /** Response curve exponent (1 = linear, >1 = finer control near center). */
  sensitivity: number;
  haptics: boolean;
  /** Button scale multiplier. */
  buttonScale: number;
}

export const DEFAULT_TOUCH: TouchSettings = { stickRadius: 62, deadZone: 0.12, sensitivity: 1.15, haptics: true, buttonScale: 1 };

export interface CameraSettings {
  /** Camera height in meters. */
  height: number;
  /** Horizontal distance behind the focus point. */
  distance: number;
}

export const DEFAULT_CAMERA: CameraSettings = { height: 7.2, distance: 10.5 };
