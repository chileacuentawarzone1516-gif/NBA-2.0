import { getTeam } from '../data/teams';
import { buildArena, type Arena } from './ArenaBuilder';
import { CameraRig } from './CameraRig';
import type { Renderer } from './Renderer';

/** Slow orbit around an empty arena behind the menus (throttled to ~30 FPS to save battery). */
export class MenuBackdrop {
  private arena: Arena | null = null;
  private readonly camera: CameraRig;
  private rafId = 0;
  private last = -1;
  private time = 0;

  constructor(private readonly renderer: Renderer) {
    this.camera = new CameraRig(renderer.camera);
  }

  start(): void {
    if (!this.arena) {
      this.arena = buildArena(this.renderer.preset, getTeam('comets'), getTeam('tides'), this.renderer.maxAnisotropy);
      this.renderer.scene.add(this.arena.root);
    }
    if (this.rafId) return;
    this.last = -1;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    if (this.arena) {
      this.renderer.scene.remove(this.arena.root);
      this.arena.dispose();
      this.arena = null;
    }
  }

  /** Rebuilds the arena after a quality change. */
  rebuild(): void {
    const running = this.rafId !== 0;
    this.stop();
    if (running) this.start();
  }

  private readonly frame = (now: number): void => {
    this.rafId = requestAnimationFrame(this.frame);
    if (this.last >= 0 && now - this.last < 31) return;
    const dt = this.last < 0 ? 0.016 : Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.camera.orbit(dt);
    this.arena?.update(this.time, 0.15);
    this.renderer.render();
  };
}
