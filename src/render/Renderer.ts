import {
  ACESFilmicToneMapping,
  Color,
  Fog,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { createLogger } from '../core/logger';
import type { QualityPreset } from '../data/quality';

const log = createLogger('renderer');

/**
 * Owns the WebGL context, the scene and the main camera. Quality changes that affect
 * context creation (antialias) rebuild the renderer on the same canvas.
 */
export class Renderer {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(48, 16 / 9, 0.1, 220);
  private gl: WebGLRenderer;
  private quality: QualityPreset;
  /** Dynamic resolution multiplier driven by the frame-time monitor. */
  private dynamicScale = 1;
  private contextLost = false;

  constructor(
    private canvas: HTMLCanvasElement,
    quality: QualityPreset,
  ) {
    this.quality = quality;
    this.gl = this.createGl(quality);
    this.scene.background = new Color(0x07090f);
    this.scene.fog = new Fog(0x07090f, 38, 120);
    canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);
    this.resize();
  }

  private createGl(quality: QualityPreset): WebGLRenderer {
    const gl = new WebGLRenderer({
      canvas: this.canvas,
      antialias: quality.antialias,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    gl.outputColorSpace = SRGBColorSpace;
    gl.toneMapping = ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.05;
    gl.shadowMap.enabled = quality.shadowMapSize > 0;
    gl.shadowMap.type = PCFShadowMap;
    return gl;
  }

  get maxAnisotropy(): number {
    return this.gl.capabilities.getMaxAnisotropy();
  }

  get preset(): QualityPreset {
    return this.quality;
  }

  /** Applies a new preset. Returns true when the scene must be rebuilt (materials/shadows). */
  setQuality(quality: QualityPreset): boolean {
    const needsNewContext = quality.antialias !== this.quality.antialias;
    const needsRebuild = needsNewContext || quality.pbr !== this.quality.pbr || quality.shadowMapSize !== this.quality.shadowMapSize;
    this.quality = quality;
    if (needsNewContext) {
      this.gl.dispose();
      // A canvas keeps its first context type; replacing the element is the reliable path.
      const fresh = this.canvas.cloneNode(false) as HTMLCanvasElement;
      this.canvas.replaceWith(fresh);
      this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
      this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
      this.canvas = fresh;
      fresh.addEventListener('webglcontextlost', this.onContextLost, false);
      fresh.addEventListener('webglcontextrestored', this.onContextRestored, false);
      this.gl = this.createGl(quality);
    } else {
      this.gl.shadowMap.enabled = quality.shadowMapSize > 0;
    }
    this.dynamicScale = 1;
    this.resize();
    return needsRebuild;
  }

  setDynamicScale(scale: number): void {
    const clamped = Math.max(0.6, Math.min(1, scale));
    if (Math.abs(clamped - this.dynamicScale) < 0.02) return;
    this.dynamicScale = clamped;
    this.resize();
  }

  getDynamicScale(): number {
    return this.dynamicScale;
  }

  resize(): void {
    const width = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio) * this.quality.renderScale * this.dynamicScale;
    this.gl.setPixelRatio(ratio);
    this.gl.setSize(width, height, false);
    this.camera.aspect = width / height;
    // Keep the court readable on narrow aspect ratios (tablets / portrait) by widening the FOV.
    this.camera.fov = this.camera.aspect < 1.4 ? 58 : 48;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    if (this.contextLost) return;
    this.gl.render(this.scene, this.camera);
  }

  info(): { calls: number; triangles: number; geometries: number; textures: number } {
    const { render, memory } = this.gl.info;
    return { calls: render.calls, triangles: render.triangles, geometries: memory.geometries, textures: memory.textures };
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.gl.dispose();
  }

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    log.warn('WebGL context lost; rendering paused until restored');
  };

  private readonly onContextRestored = (): void => {
    this.contextLost = false;
    log.info('WebGL context restored');
    this.resize();
  };
}
