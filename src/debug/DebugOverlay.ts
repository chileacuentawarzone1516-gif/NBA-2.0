import { BufferGeometry, Line, LineBasicMaterial, LineLoop, Vector3, type Object3D } from 'three';
import type { DebugHooks } from '../app/GameSession';
import { t } from '../data/i18n';
import { MOVEMENT, SIM_DT } from '../data/tuning';
import { createContacts, integrateBall, resetContacts } from '../sim/systems/ballPhysics';
import { h } from '../ui/dom';

/**
 * Developer overlay (lazy-loaded chunk; gameplay never depends on it).
 * Shows performance and simulation internals and offers match manipulation tools.
 */
export class DebugOverlay {
  private readonly root: HTMLElement;
  private readonly text: HTMLElement;
  private readonly timer: number;
  private readonly helpers: Object3D[] = [];
  private readonly trajectory: Line;
  private hitboxes = false;
  private aiForHuman = false;
  private slowmo = false;

  constructor(
    parent: HTMLElement,
    private readonly hooks: DebugHooks,
  ) {
    this.text = h('pre', { class: 'debug-text' });
    const button = (label: string, action: () => void): HTMLButtonElement =>
      h('button', { class: 'debug-btn', text: label, attrs: { type: 'button' }, on: { click: action } });
    this.root = h(
      'div',
      { class: 'debug-overlay', attrs: { 'aria-label': t('debug.title') } },
      this.text,
      h(
        'div',
        { class: 'debug-actions' },
        button(t('debug.spawnBall'), () => this.hooks.spawnBall()),
        button(t('debug.toggleAi'), () => {
          this.aiForHuman = !this.aiForHuman;
          this.hooks.setHumanAi(this.aiForHuman);
        }),
        button(t('debug.slowmo'), () => {
          this.slowmo = !this.slowmo;
          this.hooks.loop.timeScale = this.slowmo ? 0.25 : 1;
        }),
        button(t('debug.hitboxes'), () => this.toggleHitboxes()),
      ),
    );
    parent.append(this.root);

    const geometry = new BufferGeometry().setFromPoints(Array.from({ length: 90 }, () => new Vector3()));
    this.trajectory = new Line(geometry, new LineBasicMaterial({ color: 0x00ffd5 }));
    this.trajectory.frustumCulled = false;
    this.hooks.renderer.scene.add(this.trajectory);
    this.timer = window.setInterval(() => this.refresh(), 200);
  }

  private toggleHitboxes(): void {
    this.hitboxes = !this.hitboxes;
    const scene = this.hooks.renderer.scene;
    if (!this.hitboxes) {
      for (const helper of this.helpers) {
        scene.remove(helper);
        (helper as Line).geometry.dispose();
      }
      this.helpers.length = 0;
      return;
    }
    const { sim } = this.hooks.match();
    for (let i = 0; i < sim.players.length; i++) {
      const points = Array.from({ length: 24 }, (_, k) => {
        const a = (k / 24) * Math.PI * 2;
        return new Vector3(Math.cos(a) * MOVEMENT.playerRadius, 0.05, Math.sin(a) * MOVEMENT.playerRadius);
      });
      const loop = new LineLoop(new BufferGeometry().setFromPoints(points), new LineBasicMaterial({ color: 0xff00aa }));
      loop.userData.playerId = i;
      scene.add(loop);
      this.helpers.push(loop);
    }
  }

  private refresh(): void {
    const { sim } = this.hooks.match();
    const stats = this.hooks.loop.stats;
    const info = this.hooks.renderer.info();
    const me = sim.players[this.hooks.controlledId()];
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const ball = sim.ball;
    const lines = [
      `FPS ${stats.fps.toFixed(0)}  frame ${stats.frameMs.toFixed(1)}ms  sim ${stats.simMs.toFixed(2)}ms  render ${stats.renderMs.toFixed(2)}ms`,
      `draw calls ${info.calls}  tris ${info.triangles}  geo ${info.geometries}  tex ${info.textures}  res x${this.hooks.renderer.getDynamicScale().toFixed(2)}`,
      memory ? `heap ${(memory.usedJSHeapSize / 1048576).toFixed(1)} MB` : 'heap n/a',
      `tick ${sim.match.tick}  phase ${sim.match.phase}  offense ${sim.match.offense}  clear ${sim.match.needsClear}`,
      `ball ${ball.phase} holder ${ball.holder} reason ${ball.looseReason}  pos (${ball.pos.x.toFixed(2)}, ${ball.pos.y.toFixed(2)}, ${ball.pos.z.toFixed(2)})`,
      me
        ? `me #${me.id} ${me.name} action ${me.action.kind} t=${me.action.t.toFixed(2)} stam ${me.stamina.toFixed(0)} v ${Math.hypot(me.vel.x, me.vel.z).toFixed(2)} stance ${me.inStance}`
        : '',
      ...sim.players.map((p) => `#${p.id} T${p.team} ${p.name.padEnd(10)} ${p.action.kind.padEnd(11)} st ${p.stamina.toFixed(0).padStart(3)} (${p.pos.x.toFixed(1)}, ${p.pos.z.toFixed(1)})`),
    ];
    this.text.textContent = lines.join('\n');
    this.updateHelpers();
  }

  private updateHelpers(): void {
    const { sim } = this.hooks.match();
    for (const helper of this.helpers) {
      const p = sim.players[helper.userData.playerId as number];
      if (p) helper.position.set(p.pos.x, 0, p.pos.z);
    }
    // Predicted ball path from current state (same physics as the simulation).
    const positions = this.trajectory.geometry.getAttribute('position');
    const body = { pos: { ...sim.ball.pos }, vel: { ...sim.ball.vel } };
    const contacts = createContacts();
    for (let i = 0; i < positions.count; i++) {
      positions.setXYZ(i, body.pos.x, body.pos.y, body.pos.z);
      if (sim.ball.phase !== 'held') {
        resetContacts(contacts);
        integrateBall(body, SIM_DT * 2, sim.hoop, contacts, { hoopCollision: true, netGuide: false });
      }
    }
    positions.needsUpdate = true;
    this.trajectory.visible = sim.ball.phase !== 'held';
  }

  dispose(): void {
    window.clearInterval(this.timer);
    const scene = this.hooks.renderer.scene;
    scene.remove(this.trajectory);
    this.trajectory.geometry.dispose();
    (this.trajectory.material as LineBasicMaterial).dispose();
    for (const helper of this.helpers) {
      scene.remove(helper);
      (helper as Line).geometry.dispose();
    }
    this.hooks.loop.timeScale = 1;
    this.hooks.setHumanAi(false);
    this.root.remove();
  }
}
