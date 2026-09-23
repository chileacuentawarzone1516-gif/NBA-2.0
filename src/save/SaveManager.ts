import { createLogger } from '../core/logger';
import type { QualityId } from '../data/quality';
import { defaultSave, sanitizeSave, SAVE_VERSION, type SaveData } from './schema';
import type { StorageAdapter } from './storage';

const log = createLogger('save');
const SAVE_KEY = 'hoopline.save';
const BACKUP_KEY = 'hoopline.save.backup';

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/**
 * Migrations from version N to N+1. Version 0 is the unversioned pre-release shape
 * (a bare object that may contain only `settings`).
 */
const MIGRATIONS: Record<number, Migration> = {
  0: (data) => ({ ...data, version: 1, career: data.career ?? {}, myPlayer: data.myPlayer ?? null }),
};

export function migrate(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  let data = raw as Record<string, unknown>;
  let version = typeof data.version === 'number' ? data.version : 0;
  if (version > SAVE_VERSION) {
    log.warn(`save version ${version} is newer than supported ${SAVE_VERSION}; reading best-effort`);
    return data;
  }
  while (version < SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new Error(`Missing save migration from v${version}`);
    data = step(data);
    version++;
  }
  return data;
}

/** Loads, migrates, validates and persists the save with a last-known-good backup. */
export class SaveManager {
  private data: SaveData;

  constructor(
    private readonly storage: StorageAdapter,
    defaultQuality: QualityId,
  ) {
    const defaults = defaultSave(defaultQuality);
    this.data = this.load(SAVE_KEY, defaults) ?? this.load(BACKUP_KEY, defaults) ?? defaults;
  }

  private load(key: string, defaults: SaveData): SaveData | null {
    const text = this.storage.get(key);
    if (!text) return null;
    try {
      return sanitizeSave(migrate(JSON.parse(text)), defaults);
    } catch (error) {
      log.warn(`could not read ${key}; ignoring it`, error);
      return null;
    }
  }

  get(): Readonly<SaveData> {
    return this.data;
  }

  /** Applies a mutation and persists immediately (saves are small and infrequent). */
  update(mutator: (draft: SaveData) => void): void {
    const draft = structuredClone(this.data);
    mutator(draft);
    this.data = sanitizeSave(draft, draft);
    const text = JSON.stringify(this.data);
    const previous = this.storage.get(SAVE_KEY);
    if (previous) this.storage.set(BACKUP_KEY, previous);
    if (!this.storage.set(SAVE_KEY, text)) log.warn('save not persisted');
  }
}
