/**
 * Rendering quality presets. Every field changes a real rendering/performance parameter
 * (see render/Renderer.ts and render/ArenaBuilder.ts).
 */
export const QUALITY_IDS = ['low', 'medium', 'high', 'ultra'] as const;
export type QualityId = (typeof QUALITY_IDS)[number];

export interface QualityPreset {
  id: QualityId;
  /** Cap on devicePixelRatio. */
  maxPixelRatio: number;
  /** Render scale applied on top of the pixel ratio (dynamic resolution base). */
  renderScale: number;
  antialias: boolean;
  /** 0 disables real-time shadows (blob shadows are used instead). */
  shadowMapSize: number;
  /** Physically based materials (Standard) vs cheaper Lambert shading. */
  pbr: boolean;
  /** Court texture resolution (width in px). */
  courtTextureSize: number;
  /** Number of crowd instances. */
  crowd: number;
  /** Max simultaneous particles. */
  particles: number;
  /** Extra arena spot lights. */
  arenaLights: boolean;
  /** Anisotropic filtering for the floor. */
  anisotropy: number;
  /** Target frame rate (the loop never renders faster than the display). */
  targetFps: 30 | 60;
}

export const QUALITY_PRESETS: Record<QualityId, QualityPreset> = {
  low: { id: 'low', maxPixelRatio: 1, renderScale: 0.85, antialias: false, shadowMapSize: 0, pbr: false, courtTextureSize: 1024, crowd: 240, particles: 24, arenaLights: false, anisotropy: 1, targetFps: 30 },
  medium: { id: 'medium', maxPixelRatio: 1.5, renderScale: 1, antialias: false, shadowMapSize: 1024, pbr: false, courtTextureSize: 2048, crowd: 700, particles: 64, arenaLights: false, anisotropy: 4, targetFps: 60 },
  high: { id: 'high', maxPixelRatio: 2, renderScale: 1, antialias: true, shadowMapSize: 2048, pbr: true, courtTextureSize: 2048, crowd: 1400, particles: 128, arenaLights: true, anisotropy: 8, targetFps: 60 },
  ultra: { id: 'ultra', maxPixelRatio: 3, renderScale: 1, antialias: true, shadowMapSize: 4096, pbr: true, courtTextureSize: 4096, crowd: 2400, particles: 256, arenaLights: true, anisotropy: 16, targetFps: 60 },
};

/** Picks a starting preset from coarse device hints (refined later by the frame-time monitor). */
export function detectDefaultQuality(hints: { memoryGb?: number; cores?: number; mobile: boolean }): QualityId {
  const memory = hints.memoryGb ?? 4;
  const cores = hints.cores ?? 4;
  if (!hints.mobile) return cores >= 8 ? 'high' : 'medium';
  if (memory <= 2 || cores <= 4) return 'low';
  if (memory <= 4) return 'medium';
  return 'high';
}
