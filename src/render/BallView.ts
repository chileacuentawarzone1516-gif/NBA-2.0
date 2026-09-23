import { Mesh, MeshBasicMaterial, PlaneGeometry, SphereGeometry, Vector3, type Texture } from 'three';
import { clamp, lerp } from '../core/math';
import type { QualityPreset } from '../data/quality';
import { BALL } from '../data/tuning';
import type { BallState, SimPlayer } from '../sim/types';
import { surface } from './materials';
import type { PlayerView } from './PlayerView';
import { createBallTexture } from './textures';

/**
 * Ball presentation. While dribbling, the bounce is animated between the handler's hand
 * and the floor using the simulation's deterministic dribble phase (so audio and gameplay
 * stay in sync); otherwise the simulated position is interpolated between ticks.
 */
export class BallView {
  readonly mesh: Mesh;
  private readonly shadow: Mesh;
  private readonly texture: Texture;
  private readonly hand = new Vector3();
  private readonly otherHand = new Vector3();
  private lastDribblePhase = 0;
  /** Called when a dribble bounce hits the floor (for audio). */
  onDribbleBounce: ((strength: number) => void) | null = null;

  constructor(quality: QualityPreset, blobTexture: Texture) {
    this.texture = createBallTexture();
    const geometry = new SphereGeometry(BALL.radius, quality.pbr ? 24 : 16, quality.pbr ? 16 : 12);
    this.mesh = new Mesh(geometry, surface(quality.pbr, { map: this.texture, roughness: 0.65 }));
    this.mesh.castShadow = quality.shadowMapSize > 0;
    const shadowGeometry = new PlaneGeometry(0.5, 0.5);
    shadowGeometry.rotateX(-Math.PI / 2);
    this.shadow = new Mesh(shadowGeometry, new MeshBasicMaterial({ map: blobTexture, transparent: true, depthWrite: false }));
    this.shadow.renderOrder = 1;
  }

  get objects(): Mesh[] {
    return [this.mesh, this.shadow];
  }

  update(ball: BallState, holder: SimPlayer | null, holderView: PlayerView | null, alpha: number, dt: number): void {
    const m = this.mesh;
    if (ball.phase === 'held' && holder && holderView) {
      const a = holder.action.kind;
      holderView.handPosition(holder.hand, this.hand);
      if (a === 'none' || a === 'dribbleMove' || a === 'stumble' || a === 'reachRecover') {
        const phase = ball.dribblePhase;
        const floorY = BALL.radius;
        const handY = Math.max(this.hand.y - BALL.radius * 0.6, floorY + 0.3);
        const s = Math.pow(Math.abs(Math.cos(Math.PI * phase)), 0.75);
        m.position.set(this.hand.x, lerp(floorY, handY, s), this.hand.z);
        if (this.lastDribblePhase < 0.5 && phase >= 0.5) this.onDribbleBounce?.(clamp(Math.hypot(holder.vel.x, holder.vel.z) / 6, 0.3, 1));
        this.lastDribblePhase = phase;
        m.rotation.x += dt * 8;
      } else {
        // Ball gripped: between both hands, biased to the shooting hand.
        holderView.handPosition(holder.hand === 1 ? -1 : 1, this.otherHand);
        m.position.set(
          lerp(this.otherHand.x, this.hand.x, 0.65),
          lerp(this.otherHand.y, this.hand.y, 0.65) + BALL.radius * 0.8,
          lerp(this.otherHand.z, this.hand.z, 0.65),
        );
        this.lastDribblePhase = 0;
      }
    } else {
      m.position.set(lerp(ball.prevPos.x, ball.pos.x, alpha), lerp(ball.prevPos.y, ball.pos.y, alpha), lerp(ball.prevPos.z, ball.pos.z, alpha));
      const speed = Math.hypot(ball.vel.x, ball.vel.z);
      // Backspin on shots, rolling spin otherwise.
      const spin = ball.phase === 'shot' ? -9 : speed / BALL.radius;
      m.rotation.x += spin * dt;
      this.lastDribblePhase = 0;
    }
    this.shadow.position.set(m.position.x, 0.011, m.position.z);
    const heightFade = clamp(1 - m.position.y / 4, 0.15, 1);
    this.shadow.scale.setScalar(0.6 + (1 - heightFade) * 0.8);
    (this.shadow.material as MeshBasicMaterial).opacity = heightFade;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.shadow.geometry.dispose();
    (this.shadow.material as MeshBasicMaterial).dispose();
    this.texture.dispose();
  }
}
