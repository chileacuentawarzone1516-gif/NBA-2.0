import { Vector3 } from 'three';
import type { QualityPreset } from '../data/quality';
import type { TeamDef } from '../data/teams';
import type { Simulation } from '../sim/Simulation';
import type { SimEvent } from '../sim/types';
import { buildArena, type Arena } from './ArenaBuilder';
import { BallView } from './BallView';
import { CameraRig } from './CameraRig';
import { Effects } from './Effects';
import { animStateFor, createSharedPlayerAssets, PlayerView, type SharedPlayerAssets } from './PlayerView';
import type { Renderer } from './Renderer';
import { createBlobTexture } from './textures';

/**
 * Presentation of one match: builds the 3D scene from a Simulation and keeps it in sync
 * each frame. It only reads simulation state; it never mutates it.
 */
export class MatchScene {
  readonly camera: CameraRig;
  private readonly arena: Arena;
  private readonly views: PlayerView[] = [];
  private readonly ball: BallView;
  private readonly effects: Effects;
  private readonly assets: SharedPlayerAssets;
  private readonly blob = createBlobTexture();
  private readonly tmp = new Vector3();
  private excitement = 0;
  private celebrateId = -1;
  private time = 0;
  private controlledId = -1;

  constructor(
    private readonly renderer: Renderer,
    private readonly sim: Simulation,
    private readonly teams: readonly [TeamDef, TeamDef],
    quality: QualityPreset,
  ) {
    this.arena = buildArena(quality, teams[0], sim.mode.hasOpponents ? teams[1] : null, renderer.maxAnisotropy);
    renderer.scene.add(this.arena.root);
    this.assets = createSharedPlayerAssets(this.blob);
    for (const p of sim.players) {
      const view = new PlayerView(p.id, p, teams[p.team], quality, this.assets);
      this.views.push(view);
      renderer.scene.add(view.root);
    }
    this.ball = new BallView(quality, this.blob);
    renderer.scene.add(...this.ball.objects);
    this.effects = new Effects(quality.particles, this.blob, this.arena.net);
    renderer.scene.add(this.effects.root);
    this.camera = new CameraRig(renderer.camera);
    const holder = sim.players[sim.ball.holder];
    this.camera.snap(holder?.pos.x ?? 0, holder?.pos.z ?? 6, sim.hoop);
  }

  set onDribbleBounce(fn: ((strength: number) => void) | null) {
    this.ball.onDribbleBounce = fn;
  }

  setControlled(playerId: number): void {
    this.controlledId = playerId;
    for (const view of this.views) {
      const p = this.sim.players[view.playerId]!;
      const controlledTeam = this.sim.players[playerId]?.team ?? 0;
      view.setHighlight(view.playerId === playerId ? 'controlled' : p.team === controlledTeam ? 'teammate' : 'opponent');
    }
  }

  /** Visual reactions to simulation events. */
  handleEvent(e: SimEvent): void {
    const { hoop } = this.sim;
    switch (e.type) {
      case 'score': {
        if (!e.counted) break;
        const team = this.teams[e.team];
        this.effects.swishNet(1);
        this.effects.burst(hoop.x, hoop.y - 0.2, hoop.z, team.colors.primary, e.points === 3 ? 40 : 24, 3.2);
        this.effects.shockwave(hoop.x, hoop.z, team.colors.accent, 2.2, 0.6);
        this.excitement = e.points === 3 || e.shotType === 'dunk' ? 1 : 0.7;
        this.celebrateId = e.player;
        if (e.shotType === 'dunk') this.camera.addShake(0.12);
        break;
      }
      case 'shotRelease':
        if (e.timing === 'perfect') {
          const p = this.sim.players[e.player];
          if (p) this.effects.shockwave(p.pos.x, p.pos.z, 0x7dffb2, 1.3, 0.35);
        }
        break;
      case 'block': {
        const b = this.sim.ball.pos;
        this.effects.burst(b.x, b.y, b.z, 0xffffff, 18, 3);
        this.camera.addShake(0.06);
        this.excitement = 0.8;
        break;
      }
      case 'steal':
      case 'deflection': {
        const b = this.sim.ball.pos;
        this.effects.burst(b.x, b.y, b.z, 0xffd23d, 12, 2.2, 0.5);
        this.excitement = Math.max(this.excitement, 0.5);
        break;
      }
      case 'defenderBeaten': {
        const d = this.sim.players[e.defender];
        if (d && e.severity > 0.5) {
          this.effects.shockwave(d.pos.x, d.pos.z, 0xff4d6d, 1.4, 0.4);
          this.excitement = Math.max(this.excitement, 0.6);
        }
        break;
      }
      case 'rim':
        if (e.strength > 3) this.effects.burst(hoop.x, hoop.y, hoop.z, 0xff7a2a, 6, 1.5, 0.35);
        break;
      case 'phase':
        if (e.phase === 'check') this.celebrateId = -1;
        break;
      default:
        break;
    }
  }

  render(alpha: number, dt: number): void {
    this.time += dt;
    const { sim } = this;
    const { ball } = sim;
    const holder = ball.phase === 'held' ? (sim.players[ball.holder] ?? null) : null;
    const celebrating = sim.match.phase === 'dead' && sim.match.deadReason === 'score';

    for (const view of this.views) {
      const p = sim.players[view.playerId]!;
      view.update(p, animStateFor(p, celebrating && p.id === this.celebrateId), alpha, dt, ball.dribblePhase, holder?.id === p.id);
    }
    // Hand anchors need fresh world matrices before the ball reads them.
    if (holder) this.views[holder.id]!.root.updateMatrixWorld(true);
    this.ball.update(ball, holder, holder ? (this.views[holder.id] ?? null) : null, alpha, dt);
    this.effects.update(dt);
    this.excitement *= Math.exp(-0.6 * dt);
    this.arena.update(this.time, this.excitement);

    // Camera focus: the ball, pulled toward the controlled player on defense.
    const bx = this.ball.mesh.position.x;
    const bz = this.ball.mesh.position.z;
    const controlled = sim.players[this.controlledId];
    let fx = bx;
    let fz = bz;
    if (controlled && controlled.team !== sim.match.offense) {
      fx = (bx + controlled.pos.x) / 2;
      fz = (bz + controlled.pos.z) / 2;
    }
    this.camera.follow(fx, fz, sim.hoop, dt);
    this.renderer.render();
  }

  /** Screen-space position (CSS pixels) of a point above a player's head, or null if off-screen. */
  projectAbovePlayer(playerId: number, heightOffset: number, width: number, height: number): { x: number; y: number } | null {
    const view = this.views[playerId];
    if (!view) return null;
    this.tmp.copy(view.root.position);
    this.tmp.y += heightOffset;
    this.tmp.project(this.renderer.camera);
    if (this.tmp.z > 1) return null;
    return { x: (this.tmp.x * 0.5 + 0.5) * width, y: (-this.tmp.y * 0.5 + 0.5) * height };
  }

  dispose(): void {
    const scene = this.renderer.scene;
    scene.remove(this.arena.root, this.effects.root, ...this.ball.objects);
    for (const view of this.views) {
      scene.remove(view.root);
      view.dispose();
    }
    this.arena.dispose();
    this.ball.dispose();
    this.effects.dispose();
    this.assets.dispose();
    this.blob.dispose();
  }
}
