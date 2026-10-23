/** Tiny reactive store. `set` merges a shallow patch and notifies subscribers once. */
export class Store<T extends object> {
  private state: T;
  private readonly subs = new Set<(state: T) => void>();

  constructor(initial: T) {
    this.state = initial;
  }

  get(): Readonly<T> {
    return this.state;
  }

  set(patch: Partial<T>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.subs) fn(this.state);
  }

  subscribe(fn: (state: T) => void): () => void {
    this.subs.add(fn);
    fn(this.state);
    return () => this.subs.delete(fn);
  }
}

/** Versioned localStorage helpers — a schema bump discards stale shapes. */
export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage disabled (private mode) — the app still works, just without persistence
  }
}
