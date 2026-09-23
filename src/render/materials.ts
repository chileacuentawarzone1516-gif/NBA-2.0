import { MeshLambertMaterial, MeshStandardMaterial, type Material, type Texture } from 'three';

/** Quality-aware material factory: PBR on high presets, Lambert (cheaper) otherwise. */
export interface SurfaceParams {
  color?: number;
  map?: Texture | null;
  roughness?: number;
  metalness?: number;
  emissive?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
}

export function surface(pbr: boolean, params: SurfaceParams): Material {
  const common = {
    color: params.color ?? 0xffffff,
    map: params.map ?? null,
    emissive: params.emissive ?? 0x000000,
    emissiveIntensity: params.emissiveIntensity ?? 1,
    transparent: params.transparent ?? false,
    opacity: params.opacity ?? 1,
  };
  if (pbr) {
    return new MeshStandardMaterial({ ...common, roughness: params.roughness ?? 0.7, metalness: params.metalness ?? 0 });
  }
  return new MeshLambertMaterial(common);
}
