import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  SpotLight,
  TorusGeometry,
  type BufferGeometry,
  type Material,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COURT, backboardFaceZ, createHoop, type Hoop } from '../data/court';
import type { QualityPreset } from '../data/quality';
import type { TeamDef } from '../data/teams';
import { surface } from './materials';
import { createCourtTexture, createNetTexture } from './textures';

/**
 * Static arena: floor, hoops, stands, instanced crowd, ribbon boards and lighting.
 * Detail scales with the quality preset.
 */
export interface Arena {
  root: Group;
  /** Rim + net of the half-court hoop (for swish animation). */
  net: Mesh;
  keyLight: DirectionalLight;
  update(time: number, excitement: number): void;
  dispose(): void;
}

const tmpObject = new Object3D();

export function buildArena(quality: QualityPreset, home: TeamDef, away: TeamDef | null, maxAnisotropy: number): Arena {
  const root = new Group();
  root.name = 'arena';
  const disposables: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  // --- Floor -------------------------------------------------------------------------
  const courtTexture = track(
    createCourtTexture(
      { size: quality.courtTextureSize, floorTint: home.arena.floorTint, paint: home.colors.primary, accent: home.colors.accent },
      Math.min(quality.anisotropy, maxAnisotropy),
    ),
  );
  const floorGeometry = track(new PlaneGeometry(COURT.length, COURT.width));
  floorGeometry.rotateX(-Math.PI / 2);
  floorGeometry.rotateY(-Math.PI / 2);
  const floor = new Mesh(floorGeometry, track(surface(quality.pbr, { map: courtTexture, roughness: 0.45 })));
  floor.receiveShadow = quality.shadowMapSize > 0;
  root.add(floor);

  const apronGeometry = track(new PlaneGeometry(COURT.width + 8, COURT.length + 10));
  apronGeometry.rotateX(-Math.PI / 2);
  const apron = new Mesh(apronGeometry, track(surface(quality.pbr, { color: new Color(home.colors.secondary).multiplyScalar(0.35).getHex(), roughness: 0.8 })));
  apron.position.y = -0.01;
  apron.receiveShadow = quality.shadowMapSize > 0;
  root.add(apron);

  // --- Hoops ---------------------------------------------------------------------------
  const netTexture = track(createNetTexture());
  let halfCourtNet: Mesh | null = null;
  for (const dir of [1, -1] as const) {
    const { group, net } = buildHoop(createHoop(dir), quality, netTexture, track);
    root.add(group);
    if (dir === 1) halfCourtNet = net;
  }

  // --- Stands and crowd ----------------------------------------------------------------
  const standMaterial = track(surface(quality.pbr, { color: 0x1a1f2b, roughness: 0.9 }));
  const tiers = 6;
  const tierDepth = 0.85;
  const tierRise = 0.45;
  const gap = 3.2;
  const seats: Array<{ x: number; y: number; z: number; ry: number }> = [];
  const sides: Array<{ along: 'x' | 'z'; offset: number; length: number; ry: number }> = [
    { along: 'z', offset: COURT.halfWidth + gap, length: COURT.length + 6, ry: -Math.PI / 2 },
    { along: 'z', offset: -(COURT.halfWidth + gap), length: COURT.length + 6, ry: Math.PI / 2 },
    { along: 'x', offset: COURT.halfLength + gap + 1, length: COURT.width + 6, ry: Math.PI },
    { along: 'x', offset: -(COURT.halfLength + gap + 1), length: COURT.width + 6, ry: 0 },
  ];
  const tierGeometries: BufferGeometry[] = [];
  for (const side of sides) {
    for (let t = 0; t < tiers; t++) {
      const geometry = new BoxGeometry(side.along === 'z' ? tierDepth : side.length, tierRise * (t + 1), side.along === 'z' ? side.length : tierDepth);
      const out = Math.sign(side.offset) * (Math.abs(side.offset) + t * tierDepth);
      if (side.along === 'z') geometry.translate(out, (tierRise * (t + 1)) / 2, 0);
      else geometry.translate(0, (tierRise * (t + 1)) / 2, out);
      tierGeometries.push(geometry);
      const count = Math.floor(side.length / 0.62);
      for (let i = 0; i < count; i++) {
        const along = -side.length / 2 + (i + 0.5) * (side.length / count);
        seats.push(
          side.along === 'z'
            ? { x: out, y: tierRise * (t + 1), z: along, ry: side.ry }
            : { x: along, y: tierRise * (t + 1), z: out, ry: side.ry },
        );
      }
    }
  }
  root.add(new Mesh(track(mergeStatic(tierGeometries)), standMaterial));

  const crowdCount = Math.min(quality.crowd, seats.length);
  const crowdGeometry = track(new CylinderGeometry(0.17, 0.22, 0.95, quality.pbr ? 7 : 5));
  crowdGeometry.translate(0, 0.47, 0);
  const crowdMaterial = track(new MeshLambertMaterial({ vertexColors: false }));
  const crowdUniforms = { uTime: { value: 0 }, uExcite: { value: 0 } };
  crowdMaterial.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = crowdUniforms.uTime;
    shader.uniforms.uExcite = crowdUniforms.uExcite;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uExcite;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float seed = instanceMatrix[3].x * 12.9898 + instanceMatrix[3].z * 78.233;
        float bob = sin(uTime * (2.0 + fract(seed) * 2.0) + seed) * (0.03 + uExcite * 0.18);
        transformed.y += max(bob, -0.02);`,
      );
  };
  const crowd = new InstancedMesh(crowdGeometry, crowdMaterial, crowdCount);
  const palette = [home.colors.primary, home.colors.secondary, away?.colors.primary ?? 0x888888, 0x2c3e50, 0xdedede, 0x444444, 0x8e3b2e];
  const color = new Color();
  // Spread instances evenly over available seats (deterministic).
  const stride = seats.length / crowdCount;
  for (let i = 0; i < crowdCount; i++) {
    const seat = seats[Math.floor(i * stride)]!;
    tmpObject.position.set(seat.x, seat.y, seat.z);
    tmpObject.rotation.set(0, seat.ry, 0);
    const s = 0.85 + ((i * 7919) % 100) / 400;
    tmpObject.scale.set(s, s, s);
    tmpObject.updateMatrix();
    crowd.setMatrixAt(i, tmpObject.matrix);
    color.setHex(palette[(i * 2654435761) % palette.length]!).multiplyScalar(0.55 + ((i * 97) % 45) / 100);
    crowd.setColorAt(i, color);
  }
  crowd.instanceMatrix.needsUpdate = true;
  if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
  crowd.frustumCulled = false;
  root.add(crowd);

  // --- Ribbon boards and center scoreboard ------------------------------------------------
  const ribbonMaterial = track(new MeshBasicMaterial({ color: new Color(home.colors.primary).multiplyScalar(1.1) }));
  const ribbonAccent = track(new MeshBasicMaterial({ color: away ? away.colors.primary : home.colors.accent }));
  for (const sx of [1, -1]) {
    const ribbon = new Mesh(track(new BoxGeometry(0.06, 0.55, COURT.length + 4)), sx > 0 ? ribbonMaterial : ribbonAccent);
    ribbon.position.set(sx * (COURT.halfWidth + gap - 0.4), 0.55, 0);
    root.add(ribbon);
  }
  const board = new Mesh(track(new BoxGeometry(3.6, 2.2, 3.6)), track(surface(quality.pbr, { color: 0x111318, emissive: home.colors.primary, emissiveIntensity: 0.25, roughness: 0.4 })));
  board.position.set(0, 13, 0);
  root.add(board);

  // --- Lighting ---------------------------------------------------------------------------
  const hemi = new HemisphereLight(0xdfe8ff, 0x3a2a1a, quality.pbr ? 1.1 : 1.35);
  root.add(hemi);
  const key = new DirectionalLight(0xfff4e6, quality.pbr ? 2.4 : 1.6);
  key.position.set(-6, 18, 4);
  key.target.position.set(0, 0, 8);
  root.add(key, key.target);
  if (quality.shadowMapSize > 0) {
    key.castShadow = true;
    key.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    key.shadow.radius = 3;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.02;
    const cam = key.shadow.camera;
    cam.left = -10;
    cam.right = 10;
    cam.top = 10;
    cam.bottom = -10;
    cam.near = 4;
    cam.far = 40;
  }
  if (quality.arenaLights) {
    for (const [x, z] of [[-6, 4], [6, 4], [-6, 12], [6, 12]] as const) {
      const spot = new SpotLight(0xffffff, 60, 30, 0.6, 0.6, 1.6);
      spot.position.set(x, 16, z - 4);
      spot.target.position.set(x * 0.3, 0, z);
      root.add(spot, spot.target);
    }
  }

  const net = halfCourtNet ?? new Mesh();
  return {
    root,
    net,
    keyLight: key,
    update(time: number, excitement: number): void {
      crowdUniforms.uTime.value = time;
      crowdUniforms.uExcite.value += (excitement - crowdUniforms.uExcite.value) * 0.05;
    },
    dispose(): void {
      for (const item of disposables) item.dispose();
      crowd.dispose();
    },
  };
}

/** Merges static geometries sharing one material into a single draw call. */
function mergeStatic(geometries: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(geometries, false);
  for (const g of geometries) g.dispose();
  if (!merged) throw new Error('Failed to merge static arena geometry');
  return merged;
}

function buildHoop(
  hoop: Hoop,
  quality: QualityPreset,
  netTexture: import('three').Texture,
  track: <T extends { dispose(): void }>(item: T) => T,
): { group: Group; net: Mesh } {
  const group = new Group();
  const faceZ = backboardFaceZ(hoop);
  const castShadow = quality.shadowMapSize > 0;

  // Stanchion behind the baseline.
  const padMaterial = track(surface(quality.pbr, { color: 0x1d2433, roughness: 0.6 }));
  const base = new BoxGeometry(1.4, 1.1, 1.6).translate(0, 0.55, hoop.dir * (COURT.halfLength + 1.6));
  const pole = new BoxGeometry(0.22, 3.3, 0.22).translate(0, 2.5, hoop.dir * (COURT.halfLength + 1.3));
  const arm = new BoxGeometry(0.16, 0.2, COURT.halfLength + 1.3 - Math.abs(faceZ)).translate(0, 3.55, hoop.dir * ((COURT.halfLength + 1.3 + Math.abs(faceZ)) / 2));
  const stanchion = new Mesh(track(mergeStatic([base, pole, arm])), padMaterial);
  stanchion.castShadow = castShadow;
  group.add(stanchion);

  // Backboard: tinted glass with a white frame and shooter's square.
  const glass = new Mesh(
    track(new BoxGeometry(COURT.backboardWidth, COURT.backboardHeight, COURT.backboardThickness)),
    track(surface(quality.pbr, { color: 0xcfe8ff, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.1 })),
  );
  glass.position.set(0, COURT.backboardBottom + COURT.backboardHeight / 2, faceZ + (hoop.dir * COURT.backboardThickness) / 2);
  group.add(glass);
  const frameMaterial = track(new MeshBasicMaterial({ color: 0xffffff }));
  const frameParts: Array<[number, number, number, number]> = [
    [COURT.backboardWidth, 0.05, 0, COURT.backboardHeight / 2 - 0.025],
    [COURT.backboardWidth, 0.05, 0, -COURT.backboardHeight / 2 + 0.025],
    [0.05, COURT.backboardHeight, COURT.backboardWidth / 2 - 0.025, 0],
    [0.05, COURT.backboardHeight, -COURT.backboardWidth / 2 + 0.025, 0],
    [0.59, 0.05, 0, -0.1],
    [0.59, 0.05, 0, 0.35],
    [0.05, 0.45, 0.27, 0.125],
    [0.05, 0.45, -0.27, 0.125],
  ];
  const frameGeometries = frameParts.map(([w, h, x, y]) => {
    const part = new PlaneGeometry(w, h);
    if (hoop.dir === 1) part.rotateY(Math.PI);
    return part.translate(x, glass.position.y + y, faceZ - hoop.dir * 0.002);
  });
  group.add(new Mesh(track(mergeStatic(frameGeometries)), frameMaterial));

  // Rim.
  const rim = new Mesh(
    track(new TorusGeometry(COURT.rimRadius, COURT.rimTubeRadius, 8, 32)),
    track(surface(quality.pbr, { color: 0xff5a1a, roughness: 0.35, metalness: 0.6 })),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.set(hoop.x, hoop.y, hoop.z);
  rim.castShadow = castShadow;
  const bracketLength = Math.abs(faceZ - hoop.z) - COURT.rimRadius;
  const bracket = new Mesh(track(new BoxGeometry(0.12, 0.06, bracketLength)), rim.material as Material);
  bracket.position.set(0, hoop.y - 0.02, faceZ - (hoop.dir * bracketLength) / 2);
  group.add(rim, bracket);

  // Net: open tapered cylinder with an alpha-tested mesh texture.
  const netGeometry = track(new CylinderGeometry(COURT.rimRadius, COURT.rimRadius * 0.62, 0.45, 20, 3, true));
  netGeometry.translate(0, -0.225, 0);
  netTexture.repeat.set(3, 1);
  const net = new Mesh(netGeometry, track(new MeshBasicMaterial({ map: netTexture, transparent: true, alphaTest: 0.35, side: DoubleSide })));
  net.position.set(hoop.x, hoop.y, hoop.z);
  group.add(net);
  return { group, net };
}
