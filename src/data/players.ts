import { ARCHETYPES, type ArchetypeId } from './archetypes';
import { ATTRIBUTE_KEYS, clampRating, computeOverall, type Attributes, type Position } from './attributes';
import { Rng, hashSeed } from '../core/rng';

/**
 * Fictional roster. All names and identities are original. Attributes are derived
 * deterministically from the archetype template, a tier offset and a seeded variation,
 * then hand-tuned with per-player tweaks.
 */

export interface PlayerLook {
  /** Index into the renderer's skin tone palette. */
  skinTone: number;
  /** Index into the renderer's hair style set. */
  hairStyle: number;
}

export interface PlayerDef {
  id: string;
  firstName: string;
  lastName: string;
  number: number;
  position: Position;
  archetype: ArchetypeId;
  height: number;
  build: number;
  attributes: Attributes;
  look: PlayerLook;
}

type Tier = 'star' | 'starter' | 'role';
const TIER_OFFSET: Record<Tier, number> = { star: 9, starter: 4, role: -1 };

interface PlayerSeed {
  id: string;
  first: string;
  last: string;
  number: number;
  position: Position;
  archetype: ArchetypeId;
  tier: Tier;
  tweaks?: Partial<Attributes>;
  heightDelta?: number;
}

export function buildPlayer(seed: PlayerSeed): PlayerDef {
  const archetype = ARCHETYPES[seed.archetype];
  const rng = new Rng(hashSeed(seed.id));
  const attributes = {} as Attributes;
  for (const key of ATTRIBUTE_KEYS) {
    const base = archetype.template[key] ?? 50;
    const variation = rng.int(-4, 4);
    attributes[key] = clampRating(base + TIER_OFFSET[seed.tier] + variation + (seed.tweaks?.[key] ?? 0));
  }
  return {
    id: seed.id,
    firstName: seed.first,
    lastName: seed.last,
    number: seed.number,
    position: seed.position,
    archetype: seed.archetype,
    height: Math.round((archetype.body.height + (seed.heightDelta ?? rng.range(-0.04, 0.04))) * 100) / 100,
    build: archetype.body.build,
    attributes,
    look: { skinTone: rng.int(0, 5), hairStyle: rng.int(0, 3) },
  };
}

const SEEDS: PlayerSeed[] = [
  // Vantage City Comets
  { id: 'dorian-vale', first: 'Dorian', last: 'Vale', number: 3, position: 'PG', archetype: 'playmaker', tier: 'star' },
  { id: 'marek-holloway', first: 'Marek', last: 'Holloway', number: 11, position: 'SG', archetype: 'sharpshooter', tier: 'starter' },
  { id: 'tobias-crane', first: 'Tobias', last: 'Crane', number: 7, position: 'SF', archetype: 'slasher', tier: 'starter' },
  { id: 'nnamdi-roarke', first: 'Nnamdi', last: 'Roarke', number: 34, position: 'PF', archetype: 'insideScorer', tier: 'role' },
  { id: 'evander-stroud', first: 'Evander', last: 'Stroud', number: 50, position: 'C', archetype: 'rimProtector', tier: 'starter' },
  // Port Solace Tides
  { id: 'caius-whitlock', first: 'Caius', last: 'Whitlock', number: 1, position: 'PG', archetype: 'shotCreator', tier: 'star' },
  { id: 'rafe-oyelaran', first: 'Rafe', last: 'Oyelaran', number: 5, position: 'SG', archetype: 'lockdown', tier: 'starter' },
  { id: 'soren-lindqvist', first: 'Soren', last: 'Lindqvist', number: 14, position: 'SF', archetype: 'sharpshooter', tier: 'starter' },
  { id: 'dax-moreau', first: 'Dax', last: 'Moreau', number: 21, position: 'PF', archetype: 'stretchBig', tier: 'role' },
  { id: 'bram-keteku', first: 'Bram', last: 'Keteku', number: 44, position: 'C', archetype: 'rimProtector', tier: 'role' },
  // Emberfall Foxes
  { id: 'quincy-ashdown', first: 'Quincy', last: 'Ashdown', number: 2, position: 'PG', archetype: 'playmaker', tier: 'starter' },
  { id: 'lior-benhamou', first: 'Lior', last: 'Benhamou', number: 9, position: 'SG', archetype: 'shotCreator', tier: 'starter' },
  { id: 'anton-varga', first: 'Anton', last: 'Varga', number: 17, position: 'SF', archetype: 'lockdown', tier: 'role' },
  { id: 'mateo-salcedo', first: 'Mateo', last: 'Salcedo', number: 23, position: 'SF', archetype: 'slasher', tier: 'star' },
  { id: 'hollis-grange', first: 'Hollis', last: 'Grange', number: 41, position: 'C', archetype: 'insideScorer', tier: 'starter' },
  // Glacier Bay Owls
  { id: 'emeric-faye', first: 'Emeric', last: 'Faye', number: 4, position: 'PG', archetype: 'shotCreator', tier: 'starter' },
  { id: 'tavian-rhodes', first: 'Tavian', last: 'Rhodes', number: 10, position: 'SG', archetype: 'slasher', tier: 'role' },
  { id: 'niko-varda', first: 'Niko', last: 'Varda', number: 30, position: 'SF', archetype: 'sharpshooter', tier: 'star' },
  { id: 'osric-blane', first: 'Osric', last: 'Blane', number: 33, position: 'PF', archetype: 'stretchBig', tier: 'starter' },
  { id: 'gideon-mbeki', first: 'Gideon', last: 'Mbeki', number: 55, position: 'C', archetype: 'rimProtector', tier: 'starter' },
  // Sunset Mesa Vipers
  { id: 'zeke-talmadge', first: 'Zeke', last: 'Talmadge', number: 0, position: 'PG', archetype: 'playmaker', tier: 'role' },
  { id: 'callum-reyes', first: 'Callum', last: 'Reyes', number: 13, position: 'SG', archetype: 'sharpshooter', tier: 'starter' },
  { id: 'imani-okoro', first: 'Imani', last: 'Okoro', number: 8, position: 'SF', archetype: 'lockdown', tier: 'star' },
  { id: 'brennan-voss', first: 'Brennan', last: 'Voss', number: 25, position: 'PF', archetype: 'insideScorer', tier: 'starter' },
  { id: 'ulrich-stenberg', first: 'Ulrich', last: 'Stenberg', number: 52, position: 'C', archetype: 'rimProtector', tier: 'role' },
  // Ironhaven Bison
  { id: 'remy-castellanos', first: 'Remy', last: 'Castellanos', number: 6, position: 'PG', archetype: 'shotCreator', tier: 'starter' },
  { id: 'otis-farrow', first: 'Otis', last: 'Farrow', number: 12, position: 'SG', archetype: 'lockdown', tier: 'starter' },
  { id: 'jarek-novak', first: 'Jarek', last: 'Novak', number: 19, position: 'SF', archetype: 'slasher', tier: 'starter' },
  { id: 'silas-hargrove', first: 'Silas', last: 'Hargrove', number: 31, position: 'PF', archetype: 'stretchBig', tier: 'star' },
  { id: 'magnus-adeyemi', first: 'Magnus', last: 'Adeyemi', number: 42, position: 'C', archetype: 'insideScorer', tier: 'role' },
];

export const PLAYERS: ReadonlyMap<string, PlayerDef> = new Map(SEEDS.map((s) => [s.id, buildPlayer(s)]));

export function getPlayer(id: string): PlayerDef {
  const player = PLAYERS.get(id);
  if (!player) throw new Error(`Unknown player id "${id}"`);
  return player;
}

export function playerOverall(player: PlayerDef): number {
  return computeOverall(player.attributes, player.position);
}

