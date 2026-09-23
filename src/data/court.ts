/**
 * Court geometry (meters) based on the international (FIBA) standard dimensions.
 * World origin is the center of the full court; +Z runs toward the half-court
 * hoop used by half-court modes; X spans the court width.
 */

export const COURT = {
  length: 28,
  width: 15,
  halfLength: 14,
  halfWidth: 7.5,
  lineWidth: 0.05,
  /** Distance from the endline to the center of the rim. */
  rimFromBaseline: 1.575,
  rimHeight: 3.05,
  rimRadius: 0.225,
  /** Radius of the rim tube (for collision). */
  rimTubeRadius: 0.012,
  backboardFromBaseline: 1.2,
  backboardWidth: 1.8,
  backboardHeight: 1.05,
  backboardBottom: 2.9,
  backboardThickness: 0.05,
  threePointRadius: 6.75,
  /** Straight corner three lines are this far from the sidelines. */
  threePointCornerInset: 0.9,
  laneWidth: 4.9,
  freeThrowLineFromBaseline: 5.8,
  restrictedAreaRadius: 1.25,
  centerCircleRadius: 1.8,
} as const;

export interface Hoop {
  /** Rim center on the court plane. */
  x: number;
  z: number;
  /** Rim height. */
  y: number;
  /** +1 when the hoop sits at the +Z end, -1 at the -Z end. Points from midcourt toward the baseline. */
  dir: 1 | -1;
}

export function createHoop(dir: 1 | -1): Hoop {
  return { x: 0, y: COURT.rimHeight, z: dir * (COURT.halfLength - COURT.rimFromBaseline), dir };
}

/** Z coordinate of the backboard front face for a hoop. */
export function backboardFaceZ(hoop: Hoop): number {
  return hoop.dir * (COURT.halfLength - COURT.backboardFromBaseline);
}

const cornerX = COURT.halfWidth - COURT.threePointCornerInset;
/** Distance (toward midcourt) from the rim center at which corner lines meet the arc. */
export const THREE_POINT_CORNER_DEPTH = Math.sqrt(
  COURT.threePointRadius * COURT.threePointRadius - cornerX * cornerX,
);

/** Hoop-local coordinates: `lateral` across the court, `out` from the rim toward midcourt. */
export function toHoopLocal(hoop: Hoop, x: number, z: number): { lateral: number; out: number } {
  return { lateral: x - hoop.x, out: (hoop.z - z) * hoop.dir };
}

export function isThreePointZone(hoop: Hoop, x: number, z: number): boolean {
  const { lateral, out } = toHoopLocal(hoop, x, z);
  if (out < THREE_POINT_CORNER_DEPTH) return Math.abs(lateral) > cornerX;
  return lateral * lateral + out * out > COURT.threePointRadius * COURT.threePointRadius;
}

/** Signed distance outside the three-point line (positive = beyond the arc). */
export function distanceBeyondArc(hoop: Hoop, x: number, z: number): number {
  const { lateral, out } = toHoopLocal(hoop, x, z);
  if (out < THREE_POINT_CORNER_DEPTH) return Math.abs(lateral) - cornerX;
  return Math.sqrt(lateral * lateral + out * out) - COURT.threePointRadius;
}

export function distanceToHoop(hoop: Hoop, x: number, z: number): number {
  const dx = x - hoop.x;
  const dz = z - hoop.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Half-court playable bounds for the hoop at `dir` (players are clamped slightly inside). */
export interface CourtBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function halfCourtBounds(dir: 1 | -1): CourtBounds {
  return dir === 1
    ? { minX: -COURT.halfWidth, maxX: COURT.halfWidth, minZ: 0, maxZ: COURT.halfLength }
    : { minX: -COURT.halfWidth, maxX: COURT.halfWidth, minZ: -COURT.halfLength, maxZ: 0 };
}

/** Converts hoop-local (lateral, out) coordinates to world XZ. */
export function fromHoopLocal(hoop: Hoop, lateral: number, out: number): { x: number; z: number } {
  return { x: hoop.x + lateral, z: hoop.z - out * hoop.dir };
}
