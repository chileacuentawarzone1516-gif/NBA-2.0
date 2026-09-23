import { ARCHETYPE_IDS, ARCHETYPES, type ArchetypeId } from '../data/archetypes';
import { DEFAULT_CAMERA, DEFAULT_TOUCH, type CameraSettings, type TouchSettings } from '../data/controls';
import { ATTRIBUTE_KEYS, POSITIONS, clampRating, makeAttributes, type Attributes, type Position } from '../data/attributes';
import { DIFFICULTY_IDS, type DifficultyId } from '../data/difficulty';
import { LANGUAGES, detectLanguage, type Language } from '../data/i18n';
import { MODE_IDS, type ModeId } from '../data/modes';
import { QUALITY_IDS, type QualityId } from '../data/quality';
import { SKILL_IDS, MAX_EQUIPPED_SKILLS, type SkillId } from '../data/skills';
import { TEAMS } from '../data/teams';

/**
 * Persistent data schema. Everything read from storage passes through `sanitizeSave`,
 * so corrupted or hand-edited saves degrade to safe defaults instead of crashing.
 * Bump SAVE_VERSION and add a migration in SaveManager when the shape changes.
 */
export const SAVE_VERSION = 1;

export interface Settings {
  language: Language;
  quality: QualityId;
  autoResolution: boolean;
  masterVolume: number;
  sfxVolume: number;
  crowdVolume: number;
  touch: TouchSettings;
  shotAssist: boolean;
  camera: CameraSettings;
  debug: boolean;
}

export interface MyPlayerSave {
  name: string;
  archetype: ArchetypeId;
  position: Position;
  number: number;
  level: number;
  xp: number;
  upgradePoints: number;
  attributes: Attributes;
  equippedSkills: SkillId[];
  skinTone: number;
  hairStyle: number;
}

export interface CareerStats {
  games: number;
  wins: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
}

export interface LastSetup {
  mode: ModeId;
  homeTeamId: string;
  awayTeamId: string;
  difficulty: DifficultyId;
  useMyPlayer: boolean;
}

export interface SaveData {
  version: typeof SAVE_VERSION;
  settings: Settings;
  myPlayer: MyPlayerSave | null;
  career: CareerStats;
  lastSetup: LastSetup;
}

export function defaultSettings(quality: QualityId): Settings {
  return {
    language: detectLanguage(),
    quality,
    autoResolution: true,
    masterVolume: 0.8,
    sfxVolume: 0.9,
    crowdVolume: 0.6,
    touch: { ...DEFAULT_TOUCH },
    shotAssist: false,
    camera: { ...DEFAULT_CAMERA },
    debug: false,
  };
}

export function defaultSave(quality: QualityId): SaveData {
  return {
    version: SAVE_VERSION,
    settings: defaultSettings(quality),
    myPlayer: null,
    career: { games: 0, wins: 0, points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0 },
    lastSetup: { mode: 'oneOnOne', homeTeamId: TEAMS[0]!.id, awayTeamId: TEAMS[1]!.id, difficulty: 'pro', useMyPlayer: false },
  };
}

// --- Sanitizers -------------------------------------------------------------------------

type Unknown = Record<string, unknown>;

function isObject(v: unknown): v is Unknown {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

function int(v: unknown, fallback: number, min: number, max: number): number {
  return Math.round(num(v, fallback, min, max));
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback;
}

function str(v: unknown, fallback: string, maxLength: number): string {
  if (typeof v !== 'string') return fallback;
  const clean = v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, maxLength);
  return clean.length > 0 ? clean : fallback;
}

export function sanitizeSettings(raw: unknown, defaults: Settings): Settings {
  const r = isObject(raw) ? raw : {};
  const touch = isObject(r.touch) ? r.touch : {};
  const camera = isObject(r.camera) ? r.camera : {};
  return {
    language: oneOf(r.language, LANGUAGES, defaults.language),
    quality: oneOf(r.quality, QUALITY_IDS, defaults.quality),
    autoResolution: bool(r.autoResolution, defaults.autoResolution),
    masterVolume: num(r.masterVolume, defaults.masterVolume, 0, 1),
    sfxVolume: num(r.sfxVolume, defaults.sfxVolume, 0, 1),
    crowdVolume: num(r.crowdVolume, defaults.crowdVolume, 0, 1),
    touch: {
      stickRadius: num(touch.stickRadius, defaults.touch.stickRadius, 40, 110),
      deadZone: num(touch.deadZone, defaults.touch.deadZone, 0, 0.4),
      sensitivity: num(touch.sensitivity, defaults.touch.sensitivity, 0.6, 2),
      haptics: bool(touch.haptics, defaults.touch.haptics),
      buttonScale: num(touch.buttonScale, defaults.touch.buttonScale, 0.75, 1.4),
    },
    shotAssist: bool(r.shotAssist, defaults.shotAssist),
    camera: {
      height: num(camera.height, defaults.camera.height, 4.5, 11),
      distance: num(camera.distance, defaults.camera.distance, 7, 15),
    },
    debug: bool(r.debug, defaults.debug),
  };
}

export function sanitizeMyPlayer(raw: unknown): MyPlayerSave | null {
  if (!isObject(raw)) return null;
  const archetype = oneOf(raw.archetype, ARCHETYPE_IDS, 'playmaker');
  const def = ARCHETYPES[archetype];
  const attrsRaw = isObject(raw.attributes) ? raw.attributes : {};
  const attributes = makeAttributes(50);
  for (const key of ATTRIBUTE_KEYS) {
    const cap = def.caps[key] ?? 85;
    attributes[key] = Math.min(cap, clampRating(num(attrsRaw[key], def.template[key] ?? 50, 25, 99)));
  }
  const equipped = Array.isArray(raw.equippedSkills)
    ? [...new Set(raw.equippedSkills.filter((s): s is SkillId => typeof s === 'string' && (SKILL_IDS as readonly string[]).includes(s)))]
    : [];
  return {
    name: str(raw.name, 'Rookie', 16),
    archetype,
    position: oneOf(raw.position, POSITIONS, def.positions[0] ?? 'SF'),
    number: int(raw.number, 23, 0, 99),
    level: int(raw.level, 1, 1, 40),
    xp: int(raw.xp, 0, 0, 1_000_000),
    upgradePoints: int(raw.upgradePoints, 0, 0, 500),
    attributes,
    equippedSkills: equipped.slice(0, MAX_EQUIPPED_SKILLS),
    skinTone: int(raw.skinTone, 1, 0, 5),
    hairStyle: int(raw.hairStyle, 0, 0, 3),
  };
}

export function sanitizeSave(raw: unknown, defaults: SaveData): SaveData {
  const r = isObject(raw) ? raw : {};
  const career = isObject(r.career) ? r.career : {};
  const last = isObject(r.lastSetup) ? r.lastSetup : {};
  const teamIds = TEAMS.map((t) => t.id);
  return {
    version: SAVE_VERSION,
    settings: sanitizeSettings(r.settings, defaults.settings),
    myPlayer: sanitizeMyPlayer(r.myPlayer),
    career: {
      games: int(career.games, 0, 0, 1e7),
      wins: int(career.wins, 0, 0, 1e7),
      points: int(career.points, 0, 0, 1e9),
      rebounds: int(career.rebounds, 0, 0, 1e9),
      assists: int(career.assists, 0, 0, 1e9),
      steals: int(career.steals, 0, 0, 1e9),
      blocks: int(career.blocks, 0, 0, 1e9),
    },
    lastSetup: {
      mode: oneOf(last.mode, MODE_IDS, defaults.lastSetup.mode),
      homeTeamId: oneOf(last.homeTeamId, teamIds, defaults.lastSetup.homeTeamId),
      awayTeamId: oneOf(last.awayTeamId, teamIds, defaults.lastSetup.awayTeamId),
      difficulty: oneOf(last.difficulty, DIFFICULTY_IDS, defaults.lastSetup.difficulty),
      useMyPlayer: bool(last.useMyPlayer, defaults.lastSetup.useMyPlayer),
    },
  };
}
