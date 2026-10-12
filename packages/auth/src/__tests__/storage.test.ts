import { afterEach, describe, expect, it } from "@jest/globals";

import { committedValue } from "../storage";

// jsdom has no IndexedDB. This one keeps values in a map, completes each transaction on a later task as
// browsers do, and aborts every put while `failPuts` is set, as a full disk does.
function installIndexedDB() {
  const values = new Map<string, unknown>();
  const control = { failPuts: false };
  const later = (task: () => void) => setTimeout(task, 0);
  const database = {
    createObjectStore: () => undefined,
    close: () => undefined,
    transaction() {
      const transaction: Record<string, unknown> = { error: null };
      const finish = (request: { result?: unknown }, apply: () => unknown, fails = false) => {
        later(() => {
          if (fails) {
            transaction.error = new DOMException("The disk is full.", "QuotaExceededError");
            (transaction.onabort as () => void)();
            return;
          }
          request.result = apply();
          (transaction.oncomplete as () => void)();
        });
        return request;
      };
      transaction.objectStore = () => ({
        get: (key: string) => finish({}, () => values.get(key)),
        put: (value: unknown, key: string) => finish({}, () => void values.set(key, value), control.failPuts),
        delete: (key: string) => finish({}, () => void values.delete(key))
      });
      return transaction;
    }
  };
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open() {
        const request: Record<string, unknown> = { result: database };
        later(() => {
          (request.onupgradeneeded as () => void)();
          (request.onsuccess as () => void)();
        });
        return request;
      }
    }
  });
  return control;
}

afterEach(() => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
});

describe("committedValue", () => {
  it("returns what was last kept, and undefined before anything was", async () => {
    installIndexedDB();
    const value = committedValue("didit-auth:application");

    await expect(value.read()).resolves.toBeUndefined();
    await value.write("tokens");
    await expect(value.read()).resolves.toBe("tokens");
    await value.write(null);
    await expect(value.read()).resolves.toBeNull();
  });

  it("drops a value it could not replace, so it is not read as the latest", async () => {
    const control = installIndexedDB();
    const value = committedValue("didit-auth:application");
    await value.write("older");

    control.failPuts = true;
    await expect(value.write("newer")).resolves.toBeUndefined();
    control.failPuts = false;

    await expect(value.read()).resolves.toBeUndefined();
  });

  it("reads undefined, and writes nothing, where there is no IndexedDB", async () => {
    const value = committedValue("didit-auth:application");

    await expect(value.write("tokens")).resolves.toBeUndefined();
    await expect(value.read()).resolves.toBeUndefined();
  });
});
