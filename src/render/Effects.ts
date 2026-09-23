import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  RingGeometry,
  type Texture,
} from 'three';
import { GRAVITY } from '../data/tuning';

/**
 * Pooled VFX with a hard particle budget from the quality preset: sparks (points),
 * shockwave rings and net swish. No per-frame allocations.
 */
const RING_POOL = 6;

interface Particle {
  life: number;
  maxLife: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  g: number;
  b: number;
}

export class Effects {
  readonly root = new Group();
  private readonly particles: Particle[];
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly geometry = new BufferGeometry();
  private readonly points: Points;
  private readonly rings: Array<{ mesh: Mesh; material: MeshBasicMaterial; life: number; maxLife: number; grow: number }> = [];
  private readonly ringGeometry = new RingGeometry(0.8, 1, 40);
  private cursor = 0;
  private netPulse = 0;
  private readonly color = new Color();

  constructor(
    maxParticles: number,
    sparkTexture: Texture,
    private readonly net: Mesh,
  ) {
    const count = Math.max(8, maxParticles);
    this.particles = Array.from({ length: count }, () => ({ life: 0, maxLife: 1, x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1 }));
    this.positions = new Float32Array(count * 3).fill(-10);
    this.colors = new Float32Array(count * 3);
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new BufferAttribute(this.colors, 3));
    const material = new PointsMaterial({
      size: 0.16,
      map: sparkTexture,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(this.geometry, material);
    this.points.frustumCulled = false;
    this.root.add(this.points);

    this.ringGeometry.rotateX(-Math.PI / 2);
    for (let i = 0; i < RING_POOL; i++) {
      const material = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: DoubleSide, blending: AdditiveBlending });
      const mesh = new Mesh(this.ringGeometry, material);
      mesh.visible = false;
      this.root.add(mesh);
      this.rings.push({ mesh, material, life: 0, maxLife: 1, grow: 1 });
    }
  }

  burst(x: number, y: number, z: number, color: number, count: number, speed: number, life = 0.8): void {
    this.color.setHex(color);
    for (let i = 0; i < count; i++) {
      const p = this.particles[this.cursor]!;
      this.cursor = (this.cursor + 1) % this.particles.length;
      const theta = Math.random() * Math.PI * 2;
      const up = 0.3 + Math.random() * 0.9;
      const s = speed * (0.4 + Math.random() * 0.6);
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = Math.cos(theta) * s * (1 - up * 0.5);
      p.vz = Math.sin(theta) * s * (1 - up * 0.5);
      p.vy = up * s;
      p.life = p.maxLife = life * (0.6 + Math.random() * 0.4);
      p.r = this.color.r;
      p.g = this.color.g;
      p.b = this.color.b;
    }
  }

  shockwave(x: number, z: number, color: number, radius: number, life = 0.45, y = 0.03): void {
    const ring = this.rings.find((r) => r.life <= 0) ?? this.rings[0]!;
    ring.mesh.position.set(x, y, z);
    ring.mesh.visible = true;
    ring.material.color.setHex(color);
    ring.life = ring.maxLife = life;
    ring.grow = radius;
    ring.mesh.scale.setScalar(0.2);
  }

  swishNet(strength = 1): void {
    this.netPulse = Math.max(this.netPulse, strength);
  }

  update(dt: number): void {
    const pos = this.positions;
    const col = this.colors;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]!;
      const o = i * 3;
      if (p.life <= 0) {
        pos[o + 1] = -10;
        continue;
      }
      p.life -= dt;
      p.vy -= GRAVITY * 0.35 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const fade = Math.max(0, p.life / p.maxLife);
      pos[o] = p.x;
      pos[o + 1] = p.y;
      pos[o + 2] = p.z;
      col[o] = p.r * fade;
      col[o + 1] = p.g * fade;
      col[o + 2] = p.b * fade;
    }
    (this.geometry.attributes.position as BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.color as BufferAttribute).needsUpdate = true;

    for (const ring of this.rings) {
      if (ring.life <= 0) continue;
      ring.life -= dt;
      const t = 1 - Math.max(0, ring.life) / ring.maxLife;
      ring.mesh.scale.setScalar(0.2 + t * ring.grow);
      ring.material.opacity = (1 - t) * 0.85;
      if (ring.life <= 0) ring.mesh.visible = false;
    }

    // Net swish: stretch and sway, then settle.
    if (this.netPulse > 0.001) {
      this.netPulse = Math.max(0, this.netPulse - dt * 2.2);
      const wobble = Math.sin((1 - this.netPulse) * 18) * this.netPulse;
      this.net.scale.set(1 - wobble * 0.08, 1 + this.netPulse * 0.35, 1 - wobble * 0.08);
    } else {
      this.net.scale.set(1, 1, 1);
    }
  }

  dispose(): void {
    this.geometry.dispose();
    (this.points.material as PointsMaterial).dispose();
    this.ringGeometry.dispose();
    for (const ring of this.rings) ring.material.dispose();
  }
}
