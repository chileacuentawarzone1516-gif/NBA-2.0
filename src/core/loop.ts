/**
 * Fixed-timestep game loop with render interpolation.
 * Gameplay advances in constant steps (independent of display refresh rate);
 * rendering receives `alpha` to interpolate between the last two simulation states.
 */
export interface LoopCallbacks {
  /** Advances the simulation exactly one fixed step. */
  step(dt: number): void;
  /** Renders a frame. `alpha` ∈ [0,1) is the fraction of the next step already accumulated. */
  render(alpha: number, frameDt: number): void;
}

export interface LoopStats {
  fps: number;
  frameMs: number;
  stepsLastFrame: number;
  simMs: number;
  renderMs: number;
}

export class FixedStepLoop {
  readonly stats: LoopStats = { fps: 0, frameMs: 0, stepsLastFrame: 0, simMs: 0, renderMs: 0 };
  /** Scales simulated time (debug slow-motion). Does not change the step size. */
  timeScale = 1;
  /** Minimum milliseconds between rendered frames (e.g. 33.3 caps rendering at 30 FPS). */
  renderIntervalMs = 0;

  private accumulator = 0;
  private lastTime = -1;
  private rafId = 0;
  private running = false;
  private paused = false;
  private fpsFrames = 0;
  private fpsTime = 0;

  constructor(
    private readonly callbacks: LoopCallbacks,
    private readonly stepSeconds: number,
    private readonly maxStepsPerFrame = 5,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = -1;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    // Avoid a catch-up burst after resuming.
    this.accumulator = 0;
    this.lastTime = -1;
  }

  isPaused(): boolean {
    return this.paused;
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.frame);

    if (this.lastTime < 0) this.lastTime = now;
    // Frame cap: skip this display refresh; elapsed time keeps accumulating.
    if (this.renderIntervalMs > 0 && now - this.lastTime < this.renderIntervalMs - 2) return;
    // Clamp long frames (tab switches, GC pauses) to avoid a spiral of death.
    const frameDt = Math.min((now - this.lastTime) / 1000, 0.25);
    this.lastTime = now;

    let steps = 0;
    const simStart = performance.now();
    if (!this.paused) {
      this.accumulator += frameDt * this.timeScale;
      while (this.accumulator >= this.stepSeconds && steps < this.maxStepsPerFrame) {
        this.callbacks.step(this.stepSeconds);
        this.accumulator -= this.stepSeconds;
        steps++;
      }
      if (steps === this.maxStepsPerFrame) this.accumulator = 0;
    }
    const renderStart = performance.now();
    this.callbacks.render(this.paused ? 1 : this.accumulator / this.stepSeconds, frameDt);
    const end = performance.now();

    this.stats.stepsLastFrame = steps;
    this.stats.simMs = renderStart - simStart;
    this.stats.renderMs = end - renderStart;
    this.stats.frameMs = frameDt * 1000;
    this.fpsFrames++;
    this.fpsTime += frameDt;
    if (this.fpsTime >= 0.5) {
      this.stats.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
  };
}
