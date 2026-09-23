import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { COURT, THREE_POINT_CORNER_DEPTH } from '../data/court';
import { colorToCss } from '../data/teams';

/**
 * Procedurally generated textures (original artwork, no external assets): hardwood
 * court with markings, basketball, jersey numbers and the center-court emblem.
 */

function makeCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return { canvas, ctx };
}

function shade(color: number, factor: number): string {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * factor));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * factor));
  const b = Math.min(255, Math.round((color & 255) * factor));
  return `rgb(${r},${g},${b})`;
}

/** Deterministic hash noise so the floor looks identical every session. */
function noise(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export interface CourtTextureOptions {
  size: number;
  floorTint: number;
  paint: number;
  accent: number;
}

/**
 * Full-court floor texture. The canvas maps X (court length, 28 m) to width and Z
 * (court width, 15 m) to height; the mesh rotates it onto the world axes.
 */
export function createCourtTexture(options: CourtTextureOptions, anisotropy: number): CanvasTexture {
  const width = options.size;
  const height = Math.round(width * (COURT.width / COURT.length));
  const { canvas, ctx } = makeCanvas(width, height);
  const ppm = width / COURT.length;

  // Hardwood planks running along the court length.
  const plankWidth = 0.07 * ppm;
  const plankRows = Math.ceil(height / plankWidth);
  for (let row = 0; row < plankRows; row++) {
    let x = -noise(row) * 3 * ppm;
    let k = 0;
    while (x < width) {
      const len = (1.8 + noise(row * 31 + k) * 2.4) * ppm;
      const v = 0.9 + noise(row * 7 + k * 13) * 0.16;
      ctx.fillStyle = shade(options.floorTint, v);
      ctx.fillRect(x, row * plankWidth, len, plankWidth + 0.5);
      ctx.fillStyle = 'rgba(60,30,10,0.18)';
      ctx.fillRect(x, row * plankWidth, 1, plankWidth);
      x += len;
      k++;
    }
    ctx.fillStyle = 'rgba(70,35,10,0.12)';
    ctx.fillRect(0, row * plankWidth, width, 1);
  }
  // Subtle varnish sheen gradient.
  const sheen = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width * 0.6);
  sheen.addColorStop(0, 'rgba(255,240,210,0.10)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, width, height);

  // Court coordinates: u = court length axis (world Z), v = width axis (world X).
  const cx = width / 2;
  const cy = height / 2;
  const toPx = (lengthM: number, widthM: number): [number, number] => [cx + lengthM * ppm, cy + widthM * ppm];
  const line = Math.max(2, COURT.lineWidth * ppm);

  const paint = colorToCss(options.paint);
  for (const dir of [-1, 1] as const) {
    const rimLen = dir * (COURT.halfLength - COURT.rimFromBaseline);
    const baseline = dir * COURT.halfLength;
    const ftLen = dir * (COURT.halfLength - COURT.freeThrowLineFromBaseline);
    // Painted key.
    ctx.fillStyle = paint;
    ctx.globalAlpha = 0.82;
    const [kx0, ky0] = toPx(Math.min(baseline, ftLen), -COURT.laneWidth / 2);
    ctx.fillRect(kx0, ky0, Math.abs(baseline - ftLen) * ppm, COURT.laneWidth * ppm);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = '#f7f7f2';
    ctx.lineWidth = line;
    // Key outline.
    ctx.strokeRect(kx0, ky0, Math.abs(baseline - ftLen) * ppm, COURT.laneWidth * ppm);
    // Free-throw circle.
    const [ftx, fty] = toPx(ftLen, 0);
    ctx.beginPath();
    ctx.arc(ftx, fty, 1.8 * ppm, 0, Math.PI * 2);
    ctx.stroke();
    // Restricted area.
    const [rx, ry] = toPx(rimLen, 0);
    ctx.beginPath();
    const facing = dir === 1 ? Math.PI : 0;
    ctx.arc(rx, ry, COURT.restrictedAreaRadius * ppm, facing - Math.PI / 2, facing + Math.PI / 2);
    ctx.stroke();
    // Three-point line: corner straights + arc.
    const cornerW = COURT.halfWidth - COURT.threePointCornerInset;
    const joinLen = rimLen - dir * THREE_POINT_CORNER_DEPTH;
    for (const side of [-1, 1]) {
      const [ax, ay] = toPx(baseline, side * cornerW);
      const [bx, by] = toPx(joinLen, side * cornerW);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    const arcHalf = Math.asin(cornerW / COURT.threePointRadius);
    ctx.beginPath();
    ctx.arc(rx, ry, COURT.threePointRadius * ppm, facing - arcHalf, facing + arcHalf);
    ctx.stroke();
  }

  // Boundary, midcourt line, center circle.
  ctx.strokeStyle = '#f7f7f2';
  ctx.lineWidth = line * 1.2;
  ctx.strokeRect(line / 2, line / 2, width - line, height - line);
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, height);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, COURT.centerCircleRadius * ppm, 0, Math.PI * 2);
  ctx.stroke();
  drawEmblem(ctx, cx, cy, COURT.centerCircleRadius * ppm * 0.92, options.accent, options.paint);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}

/** Original center-court emblem: a stylized ball crossed by a rising line. */
function drawEmblem(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, accent: number, paint: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = colorToCss(paint);
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = colorToCss(accent);
  ctx.lineWidth = r * 0.07;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-r * 0.62, 0);
  ctx.lineTo(r * 0.62, 0);
  ctx.moveTo(0, -r * 0.62);
  ctx.quadraticCurveTo(r * 0.35, 0, 0, r * 0.62);
  ctx.stroke();
  // Rising line (the "hoop line").
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = r * 0.09;
  ctx.beginPath();
  ctx.moveTo(-r * 0.95, r * 0.45);
  ctx.lineTo(r * 0.95, -r * 0.45);
  ctx.stroke();
  ctx.restore();
}

export function createBallTexture(): CanvasTexture {
  const { canvas, ctx } = makeCanvas(512, 256);
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#e2691f');
  grad.addColorStop(0.5, '#d9601a');
  grad.addColorStop(1, '#c75514');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);
  // Pebbled grain.
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = noise(i) > 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(noise(i * 3) * 512, noise(i * 5) * 256, 1.5, 1.5);
  }
  ctx.strokeStyle = '#1b0f08';
  ctx.lineWidth = 5;
  // Equator and meridian seams (equirectangular mapping).
  ctx.beginPath();
  ctx.moveTo(0, 128);
  ctx.lineTo(512, 128);
  for (const x of [128, 384]) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
  }
  ctx.stroke();
  // Curved seams.
  for (const offset of [0, 256]) {
    ctx.beginPath();
    for (let y = 0; y <= 256; y += 4) {
      const x = offset + 128 + Math.sin((y / 256) * Math.PI) * 70 * (offset ? -1 : 1);
      if (y === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  return texture;
}

/** Jersey texture wrapped around a cylinder torso: number on front and back. */
export function createJerseyTexture(primary: number, secondary: number, accent: number, number: number): CanvasTexture {
  const { canvas, ctx } = makeCanvas(256, 128);
  ctx.fillStyle = colorToCss(primary);
  ctx.fillRect(0, 0, 256, 128);
  // Side panels and trim.
  ctx.fillStyle = colorToCss(secondary);
  ctx.fillRect(56, 0, 16, 128);
  ctx.fillRect(184, 0, 16, 128);
  ctx.fillRect(0, 0, 256, 6);
  ctx.fillStyle = colorToCss(accent);
  ctx.font = 'bold 54px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = colorToCss(secondary);
  for (const x of [128, 0, 256]) {
    // Back number at u=0.5 (x=128); the front sits at the seam (x=0/256), drawn on both halves.
    ctx.strokeText(String(number), x, 66);
    ctx.fillText(String(number), x, 66);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Soft circular blob used for cheap contact shadows. */
export function createBlobTexture(): CanvasTexture {
  const { canvas, ctx } = makeCanvas(64, 64);
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}

/** Net texture: diamond mesh on transparent background. */
export function createNetTexture(): CanvasTexture {
  const { canvas, ctx } = makeCanvas(128, 64);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 2.5;
  for (let i = -8; i < 24; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 8, 0);
    ctx.lineTo(i * 8 + 64, 64);
    ctx.moveTo(i * 8 + 64, 0);
    ctx.lineTo(i * 8, 64);
    ctx.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  return texture;
}
