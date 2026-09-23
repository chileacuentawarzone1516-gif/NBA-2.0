import { Vector3 } from 'three';
import type { AudioEngine } from '../audio/AudioEngine';
import { createLogger } from '../core/logger';
import { FixedStepLoop } from '../core/loop';
import { distanceBeyondArc } from '../data/court';
import { t } from '../data/i18n';
import { SIM_DT } from '../data/tuning';
import type { TeamDef } from '../data/teams';
import { createMatch, type Match, type MatchConfig } from '../game/matchFactory';
import { GamepadInput } from '../input/GamepadInput';
import { InputController } from '../input/InputController';
import { KeyboardInput } from '../input/KeyboardInput';
import { TouchControls } from '../input/TouchControls';
import { MatchScene } from '../render/MatchScene';
import type { Renderer } from '../render/Renderer';
import type { Settings } from '../save/schema';
import { Button, emptyInput, type PlayerInput } from '../sim/input';
import { shotTuning, timingWindows } from '../sim/systems/shooting';
import type { PlayerStats, SimEvent, TeamIndex } from '../sim/types';
import { h } from '../ui/dom';
import { Hud } from '../ui/hud/Hud';

const log = createLogger('session');
/** The human always plays for team 0 (home). */
const HUMAN_TEAM: TeamIndex = 0;

export interface MatchResult {
  config: MatchConfig;
  winner: TeamIndex;
  score: [number, number];
  humanTeam: TeamIndex;
  players: Array<{ id: number; name: string; team: TeamIndex; defId: string; stats: PlayerStats }>;
}

export interface SessionCallbacks {
  onFinish(result: MatchResult): void;
  onQuit(): void;
  onRestart(): void;
}

/** Hooks used by the (lazily loaded) debug overlay. */
export interface DebugHooks {
  match(): Match;
  loop: FixedStepLoop;
  renderer: Renderer;
  controlledId(): number;
  setHumanAi(enabled: boolean): void;
  spawnBall(): void;
}

/**
 * One playable match on the client: wires input → AI → simulation → presentation.
 * Owns its DOM (HUD, touch controls, pause menu) and 3D scene, and cleans them up.
 */
export class GameSession {
  private readonly match: Match;
  private readonly scene: MatchScene;
  private readonly hud: Hud;
  private readonly touch: TouchControls;
  private readonly input = new InputController();
  private readonly loop: FixedStepLoop;
  private readonly humans = new Set<number>();
  private readonly humanInput: PlayerInput = emptyInput();
  private readonly camDir = new Vector3();
  private readonly pauseMenu: HTMLElement;
  private controlledId: number;
  private previousButtons = 0;
  private finishTimer = -1;
  private finished = false;
  private frameEma = 16;
  private slowFor = 0;
  private fastFor = 0;
  private humanAi = false;
  private disposed = false;

  constructor(
    config: MatchConfig,
    private readonly teams: readonly [TeamDef, TeamDef],
    private readonly settings: Settings,
    private readonly renderer: Renderer,
    private readonly audio: AudioEngine,
    private readonly overlay: HTMLElement,
    private readonly callbacks: SessionCallbacks,
  ) {
    this.match = createMatch(config);
    const { sim } = this.match;
    this.scene = new MatchScene(renderer, sim, teams, renderer.preset);
    this.scene.camera.settings = { ...settings.camera };
    this.scene.onDribbleBounce = (strength) => this.audio.play('dribble', strength);

    this.hud = new Hud(overlay, teams, sim.mode.hasOpponents, () => this.setPaused(true));
    this.touch = new TouchControls(overlay, settings.touch);
    this.input.add(this.touch);
    this.input.add(new KeyboardInput());
    this.input.add(new GamepadInput());

    this.pauseMenu = this.buildPauseMenu();
    overlay.append(this.pauseMenu);

    const humanPlayer = sim.players.find((p) => p.team === HUMAN_TEAM);
    if (!humanPlayer) throw new Error('No human-controllable player');
    this.controlledId = humanPlayer.id;
    this.setControlled(this.pickDefaultControlled());

    this.loop = new FixedStepLoop({ step: (dt) => this.step(dt), render: (alpha, dt) => this.render(alpha, dt) }, SIM_DT);
    this.loop.renderIntervalMs = renderer.preset.targetFps === 30 ? 1000 / 30 : 0;
    document.addEventListener('visibilitychange', this.onVisibility);
    this.audio.startCrowd();
    this.audio.setCrowdIntensity(0.25);
  }

  start(): void {
    this.loop.start();
  }

  debugHooks(): DebugHooks {
    return {
      match: () => this.match,
      loop: this.loop,
      renderer: this.renderer,
      controlledId: () => this.controlledId,
      setHumanAi: (enabled) => {
        this.humanAi = enabled;
        this.syncHumans();
      },
      spawnBall: () => {
        const p = this.match.sim.players[this.controlledId];
        if (!p || this.match.sim.match.phase !== 'live') return;
        const ball = this.match.sim.ball;
        ball.phase = 'loose';
        ball.holder = -1;
        ball.looseReason = 'fumble';
        ball.phaseTime = 1;
        ball.pos.x = p.pos.x;
        ball.pos.y = 1.2;
        ball.pos.z = p.pos.z;
        ball.vel.x = 0;
        ball.vel.y = 0;
        ball.vel.z = 0;
      },
    };
  }

  // --- Control ---------------------------------------------------------------------------

  private pickDefaultControlled(): number {
    const { sim } = this.match;
    const { ball } = sim;
    const holder = ball.phase === 'held' ? sim.players[ball.holder] : undefined;
    if (holder && holder.team === HUMAN_TEAM) return holder.id;
    return this.closestTeammateToBall(-1);
  }

  private closestTeammateToBall(exclude: number): number {
    const { sim } = this.match;
    let best = this.controlledId;
    let bestDist = Infinity;
    for (const p of sim.players) {
      if (p.team !== HUMAN_TEAM || p.id === exclude) continue;
      const d = Math.hypot(p.pos.x - sim.ball.pos.x, p.pos.z - sim.ball.pos.z);
      if (d < bestDist) {
        bestDist = d;
        best = p.id;
      }
    }
    return best;
  }

  private setControlled(id: number): void {
    const { sim } = this.match;
    const previous = sim.players[this.controlledId];
    if (previous) previous.autoRelease = false;
    this.controlledId = id;
    const next = sim.players[id];
    if (next) next.autoRelease = this.settings.shotAssist && !this.humanAi;
    this.syncHumans();
    this.scene.setControlled(id);
  }

  private syncHumans(): void {
    this.humans.clear();
    if (!this.humanAi) this.humans.add(this.controlledId);
  }

  // --- Loop --------------------------------------------------------------------------------

  private step(dt: number): void {
    const { sim, ai, inputs } = this.match;
    const frame = this.input.sample();
    if (frame.pause) {
      this.setPaused(true);
      return;
    }
    if (frame.debug) void this.toggleDebug();

    this.renderer.camera.getWorldDirection(this.camDir);
    this.input.toPlayerInput(this.camDir.x, this.camDir.z, this.humanInput);
    const pressed = this.humanInput.buttons & ~this.previousButtons;
    this.previousButtons = this.humanInput.buttons;

    // Defense: PASS switches to the teammate closest to the ball (when there is one).
    const me = sim.players[this.controlledId];
    const defending = me && me.team !== sim.match.offense;
    if (defending && pressed & Button.Pass) {
      const next = this.closestTeammateToBall(this.controlledId);
      if (next !== this.controlledId) this.setControlled(next);
      this.humanInput.buttons &= ~Button.Pass;
    }
    const target = inputs[this.controlledId];
    if (target && !this.humanAi) {
      target.moveX = this.humanInput.moveX;
      target.moveZ = this.humanInput.moveZ;
      target.buttons = this.humanInput.buttons;
      target.passTarget = -1;
    }

    ai.update(sim, dt, inputs, this.humans);
    sim.step(inputs);
    for (const e of sim.events) this.handleEvent(e);

    if (this.finishTimer > 0) {
      this.finishTimer -= dt;
      if (this.finishTimer <= 0) this.finish();
    }
  }

  private handleEvent(e: SimEvent): void {
    const { sim } = this.match;
    this.scene.handleEvent(e);
    const mine = (id: number): boolean => id === this.controlledId;
    switch (e.type) {
      case 'shotRelease':
        if (mine(e.player)) {
          if (shotTuning(e.shotType).usesMeter && !this.settings.shotAssist) this.hud.showGrade(e.timing, e.pct, e.contest);
          if (e.timing === 'perfect') this.audio.play('perfect');
        }
        break;
      case 'score': {
        if (!e.counted) {
          this.hud.toast(t('feed.clearViolation'), 'info');
          this.audio.play('whistle');
          break;
        }
        this.audio.play('swish');
        if (e.shotType === 'dunk') {
          this.audio.play('rim', 1.2);
          this.audio.play('impact', 1.2);
          this.hud.toast(t('feed.dunk'), 'big');
        } else {
          this.hud.toast(t('feed.points', { points: e.points }), 'score', sim.players[e.player]?.name);
        }
        if (sim.match.horn) this.hud.toast(t('feed.buzzer'), 'big');
        this.audio.setCrowdIntensity(e.team === HUMAN_TEAM ? 1 : 0.55);
        window.setTimeout(() => this.audio.setCrowdIntensity(0.25), 2200);
        break;
      }
      case 'rim':
        this.audio.play('rim', Math.min(1.2, e.strength / 5));
        break;
      case 'backboard':
        this.audio.play('backboard', Math.min(1.2, e.strength / 5));
        break;
      case 'floorBounce':
        this.audio.play('bounce', Math.min(1.2, e.strength / 5));
        break;
      case 'pass':
        this.audio.play('pass');
        break;
      case 'catch': {
        this.audio.play('catch');
        // Offense: control follows the ball to the receiving teammate.
        const p = sim.players[e.player];
        if (p && p.team === HUMAN_TEAM && p.id !== this.controlledId) this.setControlled(p.id);
        break;
      }
      case 'steal':
        this.hud.toast(t('feed.steal'), 'big', sim.players[e.by]?.name);
        this.audio.play('impact', 0.7);
        this.audio.setCrowdIntensity(0.8);
        window.setTimeout(() => this.audio.setCrowdIntensity(0.25), 1500);
        break;
      case 'block':
        this.hud.toast(t('feed.block'), 'big', sim.players[e.by]?.name);
        this.audio.play('impact', 1);
        this.audio.setCrowdIntensity(0.9);
        window.setTimeout(() => this.audio.setCrowdIntensity(0.25), 1800);
        break;
      case 'defenderBeaten':
        this.audio.play('squeak', 1);
        if (e.severity > 0.6) this.hud.toast(t('feed.ankle'), 'big', sim.players[e.player]?.name);
        break;
      case 'dribbleMove':
        if (Math.random() < 0.5) this.audio.play('squeak', 0.6);
        break;
      case 'turnover':
        if (e.reason === 'shotClock') this.hud.toast(t('feed.shotClock'), 'info');
        else if (e.reason === 'outOfBounds') this.hud.toast(t('feed.outOfBounds'), 'info');
        if (e.reason === 'shotClock' || e.reason === 'outOfBounds') this.audio.play('whistle');
        break;
      case 'possession':
      case 'rebound': {
        // Offense: control follows the ball handler on my team.
        const holder = sim.ball.phase === 'held' ? sim.players[sim.ball.holder] : undefined;
        if (holder && holder.team === HUMAN_TEAM && holder.id !== this.controlledId) this.setControlled(holder.id);
        else if (e.type === 'possession' && e.team !== HUMAN_TEAM) this.setControlled(this.closestTeammateToBall(-1));
        break;
      }
      case 'phase':
        if (e.phase === 'check') {
          this.setControlled(this.pickDefaultControlled());
          if (sim.mode.hasOpponents) this.hud.toast(t('feed.checkBall', { team: this.teams[e.offense].name }), 'info');
        }
        break;
      case 'gameEnd':
        this.audio.play('buzzer');
        this.finishTimer = 2.4;
        break;
      default:
        break;
    }
  }

  private render(alpha: number, frameDt: number): void {
    if (this.disposed) return;
    const { sim } = this.match;
    this.scene.render(alpha, frameDt);
    this.hud.updateMatch(sim.match, sim.mode.practice);
    const me = sim.players[this.controlledId];
    if (me) {
      this.hud.updateStamina(me.name, me.stamina, me.exhausted);
      this.updateMeter(me.id);
      this.updateTouchLabels(me.id);
    }
    this.monitorPerformance(frameDt);
  }

  private updateMeter(id: number): void {
    const { sim } = this.match;
    const p = sim.players[id]!;
    const a = p.action;
    const visible = a.kind === 'shotGather' && !this.settings.shotAssist && sim.ball.holder === id;
    if (!visible) {
      this.hud.updateShotMeter({ visible: false, t: 0, releaseTime: 1, perfect: 0, good: 0, ok: 0, x: 0, y: 0 });
      return;
    }
    const w = this.overlay.clientWidth;
    const hgt = this.overlay.clientHeight;
    const screen = this.scene.projectAbovePlayer(id, p.height * 0.7, w, hgt);
    const type = a.shotType ?? 'jumper';
    const windows = timingWindows(p, type, distanceBeyondArc(sim.hoop, p.pos.x, p.pos.z) > 0);
    this.hud.updateShotMeter({
      visible: screen !== null,
      t: a.t,
      releaseTime: a.releaseTime,
      perfect: windows.perfect,
      good: windows.good,
      ok: windows.ok,
      x: (screen?.x ?? 0) + 34,
      y: (screen?.y ?? 0) - 40,
    });
  }

  private updateTouchLabels(id: number): void {
    const { sim } = this.match;
    const p = sim.players[id]!;
    const hasBall = sim.ball.phase === 'held' && sim.ball.holder === id;
    const defending = p.team !== sim.match.offense;
    const teammates = sim.mode.teamSize > 1;
    if (hasBall) {
      this.touch.setLabels({ shoot: t('hud.shoot'), pass: teammates ? t('hud.pass') : '—', skill: t('hud.move'), sprint: t('hud.sprint') });
    } else if (defending) {
      this.touch.setLabels({ shoot: t('hud.block'), pass: teammates ? t('hud.switch') : '—', skill: t('hud.steal'), sprint: t('hud.sprint') });
    } else {
      this.touch.setLabels({ shoot: t('hud.jump'), pass: teammates ? t('hud.callBall') : '—', skill: '—', sprint: t('hud.sprint') });
    }
  }

  /** Dynamic resolution: trades pixels for frame rate when the device struggles. */
  private monitorPerformance(frameDt: number): void {
    if (!this.settings.autoResolution || this.loop.isPaused()) return;
    const ms = frameDt * 1000;
    this.frameEma = this.frameEma * 0.95 + ms * 0.05;
    const target = 1000 / this.renderer.preset.targetFps;
    if (this.frameEma > target * 1.25) {
      this.slowFor += frameDt;
      this.fastFor = 0;
      if (this.slowFor > 2) {
        this.renderer.setDynamicScale(this.renderer.getDynamicScale() - 0.1);
        this.slowFor = 0;
      }
    } else if (this.frameEma < target * 1.05) {
      this.fastFor += frameDt;
      this.slowFor = 0;
      if (this.fastFor > 6) {
        this.renderer.setDynamicScale(this.renderer.getDynamicScale() + 0.05);
        this.fastFor = 0;
      }
    }
  }

  // --- Pause / finish ----------------------------------------------------------------------

  private buildPauseMenu(): HTMLElement {
    const resume = h('button', { class: 'btn btn-primary', text: t('pause.resume'), attrs: { type: 'button' }, on: { click: () => this.setPaused(false) } });
    return h(
      'div',
      { class: 'modal', attrs: { hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': t('pause.title') } },
      h(
        'div',
        { class: 'modal-card' },
        h('h2', { text: t('pause.title') }),
        h('p', { class: 'muted small', text: t('pause.controls') }),
        h(
          'div',
          { class: 'btn-col' },
          resume,
          h('button', { class: 'btn', text: t('pause.restart'), attrs: { type: 'button' }, on: { click: () => this.callbacks.onRestart() } }),
          h('button', { class: 'btn btn-ghost', text: t('pause.quit'), attrs: { type: 'button' }, on: { click: () => this.callbacks.onQuit() } }),
        ),
      ),
    );
  }

  setPaused(paused: boolean): void {
    if (this.finished || this.disposed) return;
    this.loop.setPaused(paused);
    this.pauseMenu.hidden = !paused;
    this.input.setEnabled(!paused);
    this.previousButtons = 0;
    if (paused) (this.pauseMenu.querySelector('.btn-primary') as HTMLElement | null)?.focus();
  }

  private readonly onVisibility = (): void => {
    if (document.hidden) this.setPaused(true);
  };

  private debugOverlay: { dispose(): void } | null = null;

  async toggleDebug(): Promise<void> {
    if (this.debugOverlay) {
      this.debugOverlay.dispose();
      this.debugOverlay = null;
      return;
    }
    try {
      // Lazy chunk: debug tooling never ships in the main bundle path.
      const { DebugOverlay } = await import('../debug/DebugOverlay');
      if (this.disposed) return;
      this.debugOverlay = new DebugOverlay(this.overlay, this.debugHooks());
    } catch (error) {
      log.error('debug overlay failed to load', error);
    }
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    const { sim, config } = this.match;
    const result: MatchResult = {
      config,
      winner: sim.match.winner === -1 ? 0 : sim.match.winner,
      score: [sim.match.score[0], sim.match.score[1]],
      humanTeam: HUMAN_TEAM,
      players: sim.players.map((p) => ({ id: p.id, name: p.name, team: p.team, defId: p.defId, stats: { ...p.stats } })),
    };
    this.callbacks.onFinish(result);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop.stop();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.debugOverlay?.dispose();
    this.input.dispose();
    this.hud.dispose();
    this.pauseMenu.remove();
    this.scene.dispose();
    this.renderer.setDynamicScale(1);
    this.audio.setCrowdIntensity(0.1);
  }
}

