import type { AuthSnapshot, DiditSession } from "./types.js";

export interface AuthStore {
  get(): AuthSnapshot;
  set(next: AuthSnapshot): void;
  subscribe(listener: () => void): () => void;
}

export function snapshotOf(session: DiditSession | null): AuthSnapshot {
  return session ? { status: "signed-in", session } : { status: "signed-out", session: null };
}

/** A tiny external store for `useSyncExternalStore`, shared by every client. */
export function createAuthStore(initial: AuthSnapshot): AuthStore {
  let current = initial;
  const listeners = new Set<() => void>();

  return {
    get: () => current,
    set(next) {
      if (next.status === current.status && next.session === current.session) return;
      current = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}
