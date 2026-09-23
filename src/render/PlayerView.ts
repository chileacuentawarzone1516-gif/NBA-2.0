import {
  Bone,
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  Uint16BufferAttribute,
  Vector3,
  type Material,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, damp, lerp } from '../core/math';
import type { QualityPreset } from '../data/quality';
import type { TeamDef } from '../data/teams';
import type { SimPlayer } from '../sim/types';
import { surface } from './materials';
import { createJerseyTexture } from './textures';

/**
 * Procedural player rig and animation (FUNCTIONAL PLACEHOLDER ART).
 *
 * The rig is a hierarchy of joint groups. `animStateFor` maps simulation state to an
 * AnimState; the view turns it into a target pose and blends toward it every frame. To ship final art,
 * replace `buildRig` with a skinned GLTF and map `AnimState` to AnimationMixer clips —
 * the `AnimState` interface and the hand anchor contract stay the same.
 */

const SKIN_TONES = [0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d, 0x5c3a21, 0x3b2219];
const HAIR_COLORS = [0x1a1110, 0x2b1a12, 0x0e0e0e, 0x3d2b1f];

export type AnimState =
  | 'idle'
  | 'locomotion'
  | 'stance'
  | 'dribbleMove'
  | 'shootGather'
  | 'shootFollow'
  | 'layup'
  | 'dunk'
  | 'pumpFake'
  | 'pass'
  | 'steal'
  | 'jump'
  | 'stumble'
  | 'celebrate';

interface Pose {
  crouch: number;
  lean: number;
  leanSide: number;
  headPitch: number;
  lShoulderPitch: number;
  lShoulderRoll: number;
  lElbow: number;
  rShoulderPitch: number;
  rShoulderRoll: number;
  rElbow: number;
  lHip: number;
  lKnee: number;
  rHip: number;
  rKnee: number;
}

const POSE_KEYS = [
  'crouch', 'lean', 'leanSide', 'headPitch', 'lShoulderPitch', 'lShoulderRoll', 'lElbow',
  'rShoulderPitch', 'rShoulderRoll', 'rElbow', 'lHip', 'lKnee', 'rHip', 'rKnee',
] as const satisfies ReadonlyArray<keyof Pose>;

function neutralPose(): Pose {
  return {
    crouch: 0.03, lean: 0.04, leanSide: 0, headPitch: 0,
    lShoulderPitch: 0.1, lShoulderRoll: 0.12, lElbow: 0.25,
    rShoulderPitch: 0.1, rShoulderRoll: 0.12, rElbow: 0.25,
    lHip: 0, lKnee: 0.06, rHip: 0, rKnee: 0.06,
  };
}

interface Rig {
  root: Group;
  hips: Bone;
  spine: Bone;
  head: Bone;
  lShoulder: Bone;
  lElbow: Bone;
  rShoulder: Bone;
  rElbow: Bone;
  lHip: Bone;
  lKnee: Bone;
  rHip: Bone;
  rKnee: Bone;
  lHand: Bone;
  rHand: Bone;
  /** Single skinned mesh (one draw call per material) built from the rigid parts. */
  body: SkinnedMesh;
  dims: { thigh: number; shin: number; legLength: number; upperArm: number; forearm: number };
}

export interface SharedPlayerAssets {
  capsule: CapsuleGeometry;
  sphere: SphereGeometry;
  box: BoxGeometry;
  torso: CylinderGeometry;
  ring: RingGeometry;
  blob: PlaneGeometry;
  blobMaterial: MeshBasicMaterial;
  dispose(): void;
}

export function createSharedPlayerAssets(blobTexture: Texture): SharedPlayerAssets {
  const capsule = new CapsuleGeometry(1, 1, 4, 8);
  const sphere = new SphereGeometry(1, 14, 10);
  const box = new BoxGeometry(1, 1, 1);
  const torso = new CylinderGeometry(1, 0.86, 1, 14, 1);
  const ring = new RingGeometry(0.46, 0.6, 32);
  ring.rotateX(-Math.PI / 2);
  const blob = new PlaneGeometry(1.1, 1.1);
  blob.rotateX(-Math.PI / 2);
  const blobMaterial = new MeshBasicMaterial({ map: blobTexture, transparent: true, depthWrite: false });
  return {
    capsule, sphere, box, torso, ring, blob, blobMaterial,
    dispose(): void {
      capsule.dispose();
      sphere.dispose();
      box.dispose();
      torso.dispose();
      ring.dispose();
      blob.dispose();
      blobMaterial.dispose();
    },
  };
}

/**
 * A limb segment hanging along -Y from its joint. The shared unit capsule is 3 units tall
 * (height 1 + two radius-1 caps); non-uniform scaling makes slightly elliptical caps,
 * which is acceptable for placeholder art.
 */
function limb(assets: SharedPlayerAssets, material: Material, length: number, radius: number, castShadow: boolean): Mesh {
  const mesh = new Mesh(assets.capsule, material);
  mesh.scale.set(radius, length / 3, radius);
  mesh.position.y = -length / 2;
  mesh.castShadow = castShadow;
  return mesh;
}

/**
 * Rigid skinning: every part mesh parented to a bone is baked in bind pose, tagged with
 * its bone index (weight 1) and merged per material into one SkinnedMesh. This turns
 * ~20 draw calls per player into one per material while keeping bone-driven animation.
 */
function bakeSkinnedBody(rootBone: Bone, castShadow: boolean): SkinnedMesh {
  rootBone.updateMatrixWorld(true);
  const bones: Bone[] = [];
  rootBone.traverse((obj) => {
    if ((obj as Bone).isBone) bones.push(obj as Bone);
  });
  const byMaterial = new Map<Material, BufferGeometry[]>();
  const parts: Mesh[] = [];
  rootBone.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    parts.push(mesh);
    const boneIndex = bones.indexOf(mesh.parent as Bone);
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    const count = geometry.getAttribute('position').count;
    const indices = new Uint16Array(count * 4);
    const weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      indices[i * 4] = boneIndex;
      weights[i * 4] = 1;
    }
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
    const material = mesh.material as Material;
    const list = byMaterial.get(material) ?? [];
    list.push(geometry);
    byMaterial.set(material, list);
  });
  for (const part of parts) part.removeFromParent();

  const materials = [...byMaterial.keys()];
  const perMaterial = materials.map((m) => {
    const list = byMaterial.get(m)!;
    const merged = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    if (!merged) throw new Error('Failed to merge player geometry');
    return merged;
  });
  const geometry = mergeGeometries(perMaterial, true);
  for (const g of perMaterial) g.dispose();
  if (!geometry) throw new Error('Failed to merge player body');

  const body = new SkinnedMesh(geometry, materials);
  body.add(rootBone);
  body.bind(new Skeleton(bones));
  body.castShadow = castShadow;
  // Animated poses (jumps, raised arms) leave the bind-pose bounds; players are always near the camera.
  body.frustumCulled = false;
  return body;
}

export class PlayerView {
  readonly root: Group;
  private readonly rig: Rig;
  private readonly pose: Pose = neutralPose();
  private readonly target: Pose = neutralPose();
  private strideCycle = 0;
  private readonly ring: Mesh;
  private readonly ringMaterial: MeshBasicMaterial;
  private readonly materials: Material[] = [];
  private readonly jersey: Texture;

  constructor(
    readonly playerId: number,
    player: SimPlayer,
    team: TeamDef,
    quality: QualityPreset,
    private readonly assets: SharedPlayerAssets,
  ) {
    const pbr = quality.pbr;
    const castShadow = quality.shadowMapSize > 0;
    const skin = surface(pbr, { color: SKIN_TONES[player.look.skinTone % SKIN_TONES.length], roughness: 0.6 });
    this.jersey = createJerseyTexture(team.colors.primary, team.colors.secondary, team.colors.accent, player.number);
    const jersey = surface(pbr, { map: this.jersey, roughness: 0.75 });
    const shorts = surface(pbr, { color: team.colors.primary, roughness: 0.75 });
    const shoes = surface(pbr, { color: team.colors.accent === 0xffffff ? 0xf4f4f4 : team.colors.accent, roughness: 0.5 });
    const hair = surface(pbr, { color: HAIR_COLORS[player.look.hairStyle % HAIR_COLORS.length], roughness: 0.9 });
    this.materials.push(skin, jersey, shorts, shoes, hair);

    this.rig = this.buildRig(player, { skin, jersey, shorts, shoes, hair }, castShadow);
    this.root = this.rig.root;

    this.ringMaterial = new MeshBasicMaterial({ color: team.colors.primary, transparent: true, opacity: 0.35, depthWrite: false });
    this.materials.push(this.ringMaterial);
    this.ring = new Mesh(assets.ring, this.ringMaterial);
    this.ring.position.y = 0.012;
    this.root.add(this.ring);

    if (!castShadow) {
      const blob = new Mesh(assets.blob, assets.blobMaterial);
      blob.position.y = 0.01;
      this.root.add(blob);
    }
  }

  private buildRig(
    player: SimPlayer,
    m: { skin: Material; jersey: Material; shorts: Material; shoes: Material; hair: Material },
    castShadow: boolean,
  ): Rig {
    const h = player.height;
    const b = player.build;
    const thigh = 0.245 * h;
    const shin = 0.235 * h;
    const legLength = thigh + shin;
    const torsoLength = 0.29 * h;
    const upperArm = 0.18 * h;
    const forearm = 0.17 * h;
    const shoulderHalf = (0.115 + b * 0.025) * h;
    const hipHalf = (0.06 + b * 0.012) * h;
    const { assets } = this;

    const root = new Group();
    const hips = new Bone();
    hips.position.y = legLength;

    // Shorts (pelvis block).
    const pelvis = new Mesh(assets.torso, m.shorts);
    pelvis.scale.set(hipHalf * 1.75, 0.13 * h, hipHalf * 1.35);
    pelvis.position.y = -0.03 * h;
    pelvis.castShadow = castShadow;
    hips.add(pelvis);

    const spine = new Bone();
    hips.add(spine);
    const torso = new Mesh(assets.torso, m.jersey);
    torso.scale.set(shoulderHalf * 0.82, torsoLength, shoulderHalf * 0.55);
    torso.position.y = torsoLength / 2;
    // Cylinder UV u=0 faces +Z (front number); u=0.5 faces -Z (back number).
    torso.castShadow = castShadow;
    spine.add(torso);

    const head = new Bone();
    head.position.y = torsoLength + 0.035 * h;
    spine.add(head);
    const neck = new Mesh(assets.capsule, m.skin);
    neck.scale.set(0.03 * h, 0.02 * h, 0.03 * h);
    head.add(neck);
    const skull = new Mesh(assets.sphere, m.skin);
    const headR = 0.062 * h;
    skull.scale.set(headR * 0.92, headR * 1.08, headR);
    skull.position.y = headR + 0.02 * h;
    skull.castShadow = castShadow;
    head.add(skull);
    const hairCap = new Mesh(assets.sphere, m.hair);
    const hairScale = [1.02, 1.06, 1.1, 1.0][player.look.hairStyle % 4]!;
    hairCap.scale.set(headR * 0.96 * hairScale, headR * 0.7 * hairScale, headR * 1.03 * hairScale);
    hairCap.position.set(0, skull.position.y + headR * 0.38, -headR * 0.08);
    head.add(hairCap);

    const arm = (side: 1 | -1): { shoulder: Bone; elbow: Bone; hand: Bone } => {
      const shoulder = new Bone();
      shoulder.position.set(side * shoulderHalf, torsoLength * 0.92, 0);
      spine.add(shoulder);
      const sleeve = new Mesh(assets.sphere, m.jersey);
      sleeve.scale.setScalar(0.045 * h);
      shoulder.add(sleeve);
      shoulder.add(limb(assets, m.skin, upperArm, 0.034 * h * (1 + b * 0.3), castShadow));
      const elbow = new Bone();
      elbow.position.y = -upperArm;
      shoulder.add(elbow);
      elbow.add(limb(assets, m.skin, forearm, 0.028 * h * (1 + b * 0.25), castShadow));
      const hand = new Bone();
      hand.position.y = -forearm;
      elbow.add(hand);
      return { shoulder, elbow, hand };
    };
    const leg = (side: 1 | -1): { hip: Bone; knee: Bone } => {
      const hip = new Bone();
      hip.position.set(side * hipHalf, 0, 0);
      hips.add(hip);
      hip.add(limb(assets, m.skin, thigh, 0.05 * h * (1 + b * 0.35), castShadow));
      const shortsLeg = new Mesh(assets.capsule, m.shorts);
      shortsLeg.scale.set(0.058 * h * (1 + b * 0.3), thigh * 0.2, 0.058 * h * (1 + b * 0.3));
      shortsLeg.position.y = -thigh * 0.3;
      hip.add(shortsLeg);
      const knee = new Bone();
      knee.position.y = -thigh;
      hip.add(knee);
      knee.add(limb(assets, m.skin, shin, 0.038 * h * (1 + b * 0.3), castShadow));
      const shoe = new Mesh(assets.box, m.shoes);
      shoe.scale.set(0.055 * h, 0.04 * h, 0.15 * h);
      shoe.position.set(0, -shin - 0.01 * h, 0.035 * h);
      shoe.castShadow = castShadow;
      knee.add(shoe);
      return { hip, knee };
    };

    const L = arm(1);
    const R = arm(-1);
    const LL = leg(1);
    const RL = leg(-1);
    const body = bakeSkinnedBody(hips, castShadow);
    root.add(body);
    return {
      root, hips, spine, head, body,
      lShoulder: L.shoulder, lElbow: L.elbow, lHand: L.hand,
      rShoulder: R.shoulder, rElbow: R.elbow, rHand: R.hand,
      lHip: LL.hip, lKnee: LL.knee, rHip: RL.hip, rKnee: RL.knee,
      dims: { thigh, shin, legLength, upperArm, forearm },
    };
  }

  setHighlight(mode: 'controlled' | 'teammate' | 'opponent'): void {
    if (mode === 'controlled') {
      this.ringMaterial.opacity = 0.95;
      this.ring.scale.setScalar(1.15);
    } else {
      this.ringMaterial.opacity = mode === 'teammate' ? 0.45 : 0.22;
      this.ring.scale.setScalar(1);
    }
  }

  /** World-space position of a hand anchor (1 = right hand, -1 = left hand). */
  handPosition(side: 1 | -1, out: Vector3): Vector3 {
    const hand = side === 1 ? this.rig.rHand : this.rig.lHand;
    return hand.getWorldPosition(out);
  }

  /**
   * Updates transform and animation. `alpha` interpolates between the previous and
   * current simulation tick; `dribblePhase` syncs the ball arm with the ball view.
   */
  update(p: SimPlayer, state: AnimState, alpha: number, dt: number, dribblePhase: number, holding: boolean): void {
    const root = this.root;
    root.position.set(lerp(p.prevPos.x, p.pos.x, alpha), lerp(p.prevPos.y, p.pos.y, alpha), lerp(p.prevPos.z, p.pos.z, alpha));
    let facing = p.facing;
    const d = p.facing - p.prevFacing;
    if (Math.abs(d) < Math.PI) facing = p.prevFacing + d * alpha;
    root.rotation.y = facing;
    // Keep the floor ring on the floor while jumping.
    this.ring.position.y = 0.012 - root.position.y;

    const speed = Math.hypot(p.vel.x, p.vel.z);
    this.computeTarget(p, state, speed, dt, dribblePhase, holding);
    const k = state === 'shootFollow' || state === 'dunk' || state === 'steal' ? 22 : 14;
    for (const key of POSE_KEYS) this.pose[key] = damp(this.pose[key], this.target[key], k, dt);
    this.applyPose(speed);
  }

  private computeTarget(p: SimPlayer, state: AnimState, speed: number, dt: number, dribblePhase: number, holding: boolean): void {
    const t = this.target;
    Object.assign(t, neutralPose());
    const a = p.action;
    const ballSide = p.hand;
    const moving = speed > 0.4;
    this.strideCycle += dt * (1.2 + speed * 1.45) * Math.PI;

    // Locomotion base layer (legs + counter arm swing).
    if (moving && !p.airborne) {
      const swing = clamp(speed / 6.5, 0.15, 0.85);
      const s = Math.sin(this.strideCycle);
      t.lHip = s * swing * 0.9;
      t.rHip = -s * swing * 0.9;
      t.lKnee = 0.15 + Math.max(0, -Math.cos(this.strideCycle)) * swing * 1.3;
      t.rKnee = 0.15 + Math.max(0, Math.cos(this.strideCycle)) * swing * 1.3;
      t.lShoulderPitch = -s * swing * 0.7;
      t.rShoulderPitch = s * swing * 0.7;
      t.lElbow = 0.5 + swing * 0.5;
      t.rElbow = 0.5 + swing * 0.5;
      t.lean = 0.06 + swing * 0.22;
    }

    switch (state) {
      case 'stance':
        t.crouch = 0.2;
        t.lean = 0.28;
        t.lShoulderPitch = 0.55;
        t.rShoulderPitch = 0.55;
        t.lShoulderRoll = 0.95;
        t.rShoulderRoll = 0.95;
        t.lElbow = 0.7;
        t.rElbow = 0.7;
        t.headPitch = -0.2;
        break;
      case 'dribbleMove':
        t.crouch = 0.16;
        t.lean = 0.3;
        break;
      case 'shootGather': {
        const progress = clamp(a.t / Math.max(0.2, a.releaseTime), 0, 1);
        t.crouch = progress < 0.45 ? 0.16 * (progress / 0.45) : 0.16 * (1 - (progress - 0.45) / 0.55);
        this.setShootingArms(ballSide, lerp(1.2, 2.75, progress), lerp(1.9, 0.9, progress));
        t.headPitch = -0.15;
        break;
      }
      case 'shootFollow':
        this.setShootingArms(ballSide, 3.0, 0.08);
        t.headPitch = -0.2;
        break;
      case 'layup':
        if (ballSide === 1) {
          t.rShoulderPitch = 2.9;
          t.rElbow = 0.2;
          t.lShoulderPitch = 1.2;
          t.lShoulderRoll = 0.4;
          t.lHip = 1.2;
          t.lKnee = 1.5;
        } else {
          t.lShoulderPitch = 2.9;
          t.lElbow = 0.2;
          t.rShoulderPitch = 1.2;
          t.rShoulderRoll = 0.4;
          t.rHip = 1.2;
          t.rKnee = 1.5;
        }
        t.headPitch = -0.35;
        break;
      case 'dunk': {
        const slam = a.released ? 1 : 0;
        t.lShoulderPitch = lerp(3.0, 1.5, slam);
        t.rShoulderPitch = lerp(3.0, 1.5, slam);
        t.lElbow = 0.15;
        t.rElbow = 0.15;
        t.lKnee = 0.9;
        t.rKnee = 0.9;
        t.lHip = 0.4;
        t.rHip = 0.4;
        break;
      }
      case 'pumpFake':
        this.setShootingArms(ballSide, 1.9, 1.3);
        t.crouch = 0.08;
        break;
      case 'pass':
        t.lShoulderPitch = 1.4;
        t.rShoulderPitch = 1.4;
        t.lElbow = 0.25;
        t.rElbow = 0.25;
        t.lean = 0.18;
        break;
      case 'steal': {
        const reachSide = ballSide === 1 ? 'l' : 'r';
        if (reachSide === 'l') {
          t.lShoulderPitch = 1.35;
          t.lElbow = 0.05;
        } else {
          t.rShoulderPitch = 1.35;
          t.rElbow = 0.05;
        }
        t.lean = 0.4;
        t.crouch = 0.15;
        break;
      }
      case 'jump':
        t.lShoulderPitch = 3.0;
        t.rShoulderPitch = 3.0;
        t.lShoulderRoll = 0.15;
        t.rShoulderRoll = 0.15;
        t.lElbow = 0.1;
        t.rElbow = 0.1;
        t.lKnee = 0.55;
        t.rKnee = 0.55;
        break;
      case 'stumble':
        t.lean = -0.35;
        t.leanSide = 0.25;
        t.lShoulderRoll = 1.3;
        t.rShoulderRoll = 1.1;
        t.crouch = 0.18;
        t.lKnee = 0.7;
        break;
      case 'celebrate':
        if (ballSide === 1) {
          t.rShoulderPitch = 2.9;
          t.rElbow = 1.2;
        } else {
          t.lShoulderPitch = 2.9;
          t.lElbow = 1.2;
        }
        t.headPitch = -0.3;
        break;
      default:
        break;
    }

    // Ball-hand dribble pump layered on locomotion/idle/moves.
    if (holding && (state === 'idle' || state === 'locomotion' || state === 'dribbleMove')) {
      const pump = Math.cos(dribblePhase * Math.PI * 2);
      if (ballSide === 1) {
        t.rShoulderPitch = 0.55 + pump * 0.12;
        t.rShoulderRoll = 0.3;
        t.rElbow = 0.95 - pump * 0.35;
      } else {
        t.lShoulderPitch = 0.55 + pump * 0.12;
        t.lShoulderRoll = 0.3;
        t.lElbow = 0.95 - pump * 0.35;
      }
      t.crouch = Math.max(t.crouch, 0.08);
      t.lean = Math.max(t.lean, 0.14);
    }

    // Airborne: tuck legs slightly.
    if (p.airborne && state !== 'layup') {
      t.lKnee = Math.max(t.lKnee, 0.45);
      t.rKnee = Math.max(t.rKnee, 0.35);
    }
    // Crouch leg IK: keep feet planted when lowering the hips.
    if (!p.airborne && t.crouch > 0.01) {
      const { thigh, shin } = this.rig.dims;
      const reachLen = thigh + shin - t.crouch;
      const cosKnee = clamp((thigh * thigh + shin * shin - reachLen * reachLen) / (2 * thigh * shin), -1, 1);
      const knee = Math.PI - Math.acos(cosKnee);
      const cosHip = clamp((thigh * thigh + reachLen * reachLen - shin * shin) / (2 * thigh * reachLen), -1, 1);
      const hip = Math.acos(cosHip);
      t.lKnee += knee;
      t.rKnee += knee;
      t.lHip += hip;
      t.rHip += hip;
    }
  }

  private setShootingArms(ballSide: 1 | -1, pitch: number, elbow: number): void {
    const t = this.target;
    if (ballSide === 1) {
      t.rShoulderPitch = pitch;
      t.rElbow = elbow;
      t.rShoulderRoll = 0.05;
      t.lShoulderPitch = pitch * 0.9;
      t.lElbow = elbow + 0.35;
      t.lShoulderRoll = 0.3;
    } else {
      t.lShoulderPitch = pitch;
      t.lElbow = elbow;
      t.lShoulderRoll = 0.05;
      t.rShoulderPitch = pitch * 0.9;
      t.rElbow = elbow + 0.35;
      t.rShoulderRoll = 0.3;
    }
  }

  private applyPose(speed: number): void {
    const r = this.rig;
    const p = this.pose;
    const bob = speed > 0.4 ? Math.abs(Math.sin(this.strideCycle)) * 0.035 * clamp(speed / 6, 0.2, 1) : 0;
    r.hips.position.y = r.dims.legLength - p.crouch + bob;
    r.spine.rotation.x = p.lean;
    r.spine.rotation.z = p.leanSide;
    r.head.rotation.x = p.headPitch;
    // Limbs hang along -Y; negative X rotation swings them forward.
    r.lShoulder.rotation.set(-p.lShoulderPitch, 0, p.lShoulderRoll);
    r.rShoulder.rotation.set(-p.rShoulderPitch, 0, -p.rShoulderRoll);
    r.lElbow.rotation.x = -p.lElbow;
    r.rElbow.rotation.x = -p.rElbow;
    r.lHip.rotation.x = -p.lHip;
    r.rHip.rotation.x = -p.rHip;
    r.lKnee.rotation.x = p.lKnee;
    r.rKnee.rotation.x = p.rKnee;
  }

  dispose(): void {
    this.rig.body.geometry.dispose();
    this.rig.body.skeleton.dispose();
    for (const m of this.materials) m.dispose();
    this.jersey.dispose();
  }
}

/** Maps simulation state to an animation state (the contract for future skinned rigs). */
export function animStateFor(p: SimPlayer, celebrating: boolean): AnimState {
  switch (p.action.kind) {
    case 'dribbleMove':
      return 'dribbleMove';
    case 'shotGather':
      return 'shootGather';
    case 'shotFollow':
      return 'shootFollow';
    case 'layup':
      return 'layup';
    case 'dunk':
      return 'dunk';
    case 'pumpFake':
      return 'pumpFake';
    case 'pass':
      return 'pass';
    case 'steal':
      return 'steal';
    case 'jump':
      return 'jump';
    case 'stumble':
      return 'stumble';
    default:
      break;
  }
  if (celebrating) return 'celebrate';
  if (p.inStance) return 'stance';
  return Math.hypot(p.vel.x, p.vel.z) > 0.4 ? 'locomotion' : 'idle';
}
