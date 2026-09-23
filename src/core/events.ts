/** Minimal strongly-typed event emitter. Listeners are isolated so one failure cannot break the others. */
export type EventMap = Record<string, unknown>;
type Listener<T> = (payload: T) => void;

export class Emitter<E extends EventMap> {
  private readonly listeners = new Map<keyof E, Set<Listener<never>>>();

  on<K extends keyof E>(type: K, listener: Listener<E[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as Listener<never>);
    return () => this.off(type, listener);
  }

  off<K extends keyof E>(type: K, listener: Listener<E[K]>): void {
    this.listeners.get(type)?.delete(listener as Listener<never>);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const listener of set) {
      try {
        (listener as Listener<E[K]>)(payload);
      } catch (error) {
        console.error(`[events] listener for "${String(type)}" failed`, error);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
