import { createLogger } from '../core/logger';

const log = createLogger('audio');

/**
 * Procedural audio (all sounds synthesized at runtime: original, license-free and zero
 * download cost). Buses: sfx and crowd → compressor → master. The context is created on
 * the first user gesture (required by iOS/Chrome autoplay policies).
 */
export type SfxId =
  | 'dribble'
  | 'bounce'
  | 'rim'
  | 'backboard'
  | 'swish'
  | 'squeak'
  | 'whistle'
  | 'buzzer'
  | 'pass'
  | 'catch'
  | 'impact'
  | 'perfect'
  | 'click';

export interface AudioVolumes {
  master: number;
  sfx: number;
  crowd: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private crowdBus: GainNode | null = null;
  private crowdFilter: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;
  private volumes: AudioVolumes = { master: 0.8, sfx: 0.9, crowd: 0.6 };
  private crowdLevel = 0.2;
  private crowdStarted = false;

  constructor() {
    const unlock = (): void => {
      this.ensureContext();
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  private ensureContext(): void {
    if (this.ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      log.warn('Web Audio unavailable; running silent');
      return;
    }
    try {
      const ctx = new Ctor({ latencyHint: 'interactive' });
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.ratio.value = 4;
      this.master = ctx.createGain();
      this.sfx = ctx.createGain();
      this.crowdBus = ctx.createGain();
      this.sfx.connect(compressor);
      this.crowdBus.connect(compressor);
      compressor.connect(this.master);
      this.master.connect(ctx.destination);
      const length = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      // Pink-ish noise (cheap filter) for natural crowd/net textures.
      let b0 = 0;
      let b1 = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.963 * b1 + white * 0.2965;
        data[i] = (b0 + b1 + white * 0.1848) * 0.3;
      }
      this.ctx = ctx;
      this.applyVolumes();
    } catch (error) {
      log.warn('could not start audio', error);
    }
  }

  setVolumes(volumes: AudioVolumes): void {
    this.volumes = { ...volumes };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.master || !this.sfx || !this.crowdBus) return;
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, now, 0.05);
    this.sfx.gain.setTargetAtTime(this.volumes.sfx, now, 0.05);
    this.crowdBus.gain.setTargetAtTime(this.volumes.crowd * this.crowdLevel, now, 0.3);
  }

  /** Starts the looping crowd ambience (idempotent). */
  startCrowd(): void {
    this.ensureContext();
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.crowdBus || this.crowdStarted) return;
    this.crowdStarted = true;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.crowdFilter = ctx.createBiquadFilter();
    this.crowdFilter.type = 'lowpass';
    this.crowdFilter.frequency.value = 650;
    src.connect(this.crowdFilter).connect(this.crowdBus);
    src.start();
  }

  /** Crowd intensity 0..1 (reacts to big plays). */
  setCrowdIntensity(level: number): void {
    this.crowdLevel = 0.15 + Math.max(0, Math.min(1, level)) * 0.85;
    if (this.ctx && this.crowdFilter) this.crowdFilter.frequency.setTargetAtTime(500 + level * 1400, this.ctx.currentTime, 0.25);
    this.applyVolumes();
  }

  play(id: SfxId, strength = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const s = Math.max(0.05, Math.min(1.5, strength));
    switch (id) {
      case 'dribble':
        this.tone(95, 42, 0.09, 0.55 * s, 'sine');
        this.noiseBurst(900, 'lowpass', 0.03, 0.25 * s);
        break;
      case 'bounce':
        this.tone(110, 50, 0.12, 0.5 * s, 'sine');
        this.noiseBurst(1100, 'lowpass', 0.04, 0.3 * s);
        break;
      case 'rim':
        for (const [f, g] of [[520, 0.3], [1310, 0.18], [2150, 0.1]] as const) this.tone(f, f * 0.99, 0.45, g * s, 'sine');
        this.noiseBurst(3500, 'highpass', 0.02, 0.2 * s);
        break;
      case 'backboard':
        this.tone(150, 90, 0.16, 0.45 * s, 'triangle');
        this.noiseBurst(420, 'bandpass', 0.08, 0.35 * s);
        break;
      case 'swish':
        this.noiseBurst(2600, 'bandpass', 0.38, 0.45 * s, 1400);
        break;
      case 'squeak':
        this.tone(2100 + Math.random() * 500, 3200, 0.07, 0.08 * s, 'sine');
        break;
      case 'whistle': {
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfo.frequency.value = 32;
        lfoGain.gain.value = 60;
        lfo.connect(lfoGain);
        for (const f of [2750, 2810]) {
          const osc = this.tone(f, f, 0.42, 0.1, 'sine');
          if (osc) lfoGain.connect(osc.frequency);
        }
        lfo.start(t);
        lfo.stop(t + 0.45);
        break;
      }
      case 'buzzer':
        this.tone(210, 205, 1.0, 0.18, 'square');
        this.tone(420, 415, 1.0, 0.06, 'square');
        break;
      case 'pass':
        this.noiseBurst(1300, 'bandpass', 0.07, 0.2 * s, 2200);
        break;
      case 'catch':
        this.tone(180, 120, 0.06, 0.3 * s, 'sine');
        this.noiseBurst(1500, 'lowpass', 0.03, 0.2 * s);
        break;
      case 'impact':
        this.tone(80, 40, 0.22, 0.6 * s, 'sine');
        this.noiseBurst(600, 'lowpass', 0.12, 0.4 * s);
        break;
      case 'perfect':
        this.tone(880, 1760, 0.18, 0.12, 'sine');
        this.tone(1320, 2640, 0.22, 0.06, 'sine');
        break;
      case 'click':
        this.tone(900, 700, 0.05, 0.08, 'sine');
        break;
    }
  }

  private tone(from: number, to: number, duration: number, gain: number, type: OscillatorType): OscillatorNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return null;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + duration);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this.sfx);
    osc.start(t);
    osc.stop(t + duration + 0.02);
    return osc;
  }

  private noiseBurst(freq: number, type: BiquadFilterType, duration: number, gain: number, sweepTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + duration);
    filter.Q.value = type === 'bandpass' ? 1.2 : 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 1.5);
    src.stop(t + duration + 0.02);
  }
}
