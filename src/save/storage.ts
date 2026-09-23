import { createLogger } from '../core/logger';

const log = createLogger('storage');

/** Key/value persistence abstraction (localStorage today; Capacitor Preferences or cloud later). */
export interface StorageAdapter {
  get(key: string): string | null;
  set(key: string, value: string): boolean;
  remove(key: string): void;
}

export class MemoryStorage implements StorageAdapter {
  private readonly data = new Map<string, string>();
  get(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  set(key: string, value: string): boolean {
    this.data.set(key, value);
    return true;
  }
  remove(key: string): void {
    this.data.delete(key);
  }
}

/** localStorage with graceful failure (private browsing, quota exceeded, disabled storage). */
export class LocalStorageAdapter implements StorageAdapter {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      log.warn('read failed', error);
      return null;
    }
  }
  set(key: string, value: string): boolean {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (error) {
      log.warn('write failed (storage full or unavailable)', error);
      return false;
    }
  }
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      log.warn('remove failed', error);
    }
  }
}

export function createDefaultStorage(): StorageAdapter {
  try {
    const probe = '__hoopline_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return new LocalStorageAdapter();
  } catch {
    log.warn('localStorage unavailable; progress will not persist this session');
    return new MemoryStorage();
  }
}
