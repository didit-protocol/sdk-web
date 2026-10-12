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

/** The synchronous part of the Web Storage API, which also lists its keys. */
export type SyncStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export function memoryStorage(): SyncStorage {
  const items = new Map<string, string>();

  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
    key: (index) => [...items.keys()][index] ?? null,
    get length() {
      return items.size;
    }
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

/**
 * One value kept in IndexedDB. Once `write` resolves, every later `read` in any tab of the origin
 * returns it, which web storage does not promise. `read` resolves undefined when nothing was kept or
 * IndexedDB cannot be used; neither method rejects.
 */
export interface CommittedValue {
  read(): Promise<string | null | undefined>;
  write(value: string | null): Promise<void>;
}

export function committedValue(key: string): CommittedValue {
  let database: Promise<IDBDatabase> | null = null;

  // Open the database again on the next use, unless that already happened.
  function forget(connection: Promise<IDBDatabase>): void {
    if (database === connection) database = null;
  }

  function connect(): Promise<IDBDatabase> {
    const connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("didit-auth", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("values");
      request.onsuccess = () => {
        const db = request.result;
        // Never hold up a later version of this database.
        db.onversionchange = () => {
          db.close();
          forget(connection);
        };
        // The browser closed it, as WebKit does when its storage process goes away.
        db.onclose = () => forget(connection);
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    });
    return connection;
  }

  function run<T>(mode: IDBTransactionMode, use: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const connection = (database ??= connect());
    return connection
      .then(
        (db) =>
          new Promise<T>((resolve, reject) => {
            const transaction = db.transaction("values", mode);
            const request = use(transaction.objectStore("values"));
            transaction.oncomplete = () => resolve(request.result);
            transaction.onabort = () => reject(transaction.error);
          })
      )
      .catch((error: unknown) => {
        // The open may have failed only for now, or the connection broke without a close event.
        forget(connection);
        throw error;
      });
  }

  return {
    read: () =>
      run("readonly", (store) => store.get(key)).then(
        (value) => (typeof value === "string" || value === null ? value : undefined),
        () => undefined
      ),
    // A value that could not be kept must not be read as the latest one.
    write: (value) =>
      run("readwrite", (store) => store.put(value, key)).then(
        () => undefined,
        () => run("readwrite", (store) => store.delete(key)).then(() => undefined, () => undefined)
      )
  };
}
