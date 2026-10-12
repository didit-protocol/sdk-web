/**
 * Where the SDK keeps the session tokens. Methods may be synchronous or
 * return promises, so an encrypted or native store can be plugged in.
 */
export interface DiditAuthStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export type DiditAuthStorageOption = "local" | "session" | "memory" | DiditAuthStorage;

export function memoryStorage(): DiditAuthStorage {
  const items = new Map<string, string>();

  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key)
  };
}

/** The browser store, or null when it does not exist or is blocked (private mode, sandboxed frames, SSR). */
export function webStorage(kind: "local" | "session"): Storage | null {
  try {
    const storage = kind === "local" ? window.localStorage : window.sessionStorage;
    const probe = "didit-auth:probe";

    storage.setItem(probe, probe);
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

export function resolveStorage(option: DiditAuthStorageOption = "local"): DiditAuthStorage {
  if (typeof option === "object") return option;
  return (option === "memory" ? null : webStorage(option)) ?? memoryStorage();
}
