import { afterEach, describe, expect, it } from "@jest/globals";

import { committedValue } from "../storage";

// jsdom has no IndexedDB. This one keeps values in a map shared by every connection, completes each
// transaction on a later task as browsers do, and aborts every put while `failPuts` is set, as a full disk
// does. `failOpens` fails that many of the next opens, and `loseConnections` closes every open connection
// the way a browser does when its storage process goes away: transactions then throw.
function installIndexedDB() {
  const values = new Map<string, unknown>();
  const connections = new Set<Record<string, unknown>>();
  const control = {
    failPuts: false,
    failOpens: 0,
    loseConnections() {
      for (const connection of connections) {
        connection.closed = true;
        (connection.onclose as (() => void) | undefined)?.();
      }
      connections.clear();
    }
  };
  const later = (task: () => void) => setTimeout(task, 0);
  const connect = () => {
    const connection: Record<string, unknown> = { closed: false };
    connection.createObjectStore = () => undefined;
    connection.close = () => {
      connection.closed = true;
      connections.delete(connection);
    };
    connection.transaction = () => {
      if (connection.closed) throw new DOMException("The database connection is closing.", "InvalidStateError");
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
    };
    connections.add(connection);
    return connection;
  };
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open() {
        const request: Record<string, unknown> = {};
        later(() => {
          if (control.failOpens > 0) {
            control.failOpens -= 1;
            request.error = new DOMException("Internal error opening backing store.", "UnknownError");
            (request.onerror as () => void)();
            return;
          }
          request.result = connect();
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

  it("opens IndexedDB again after it failed to, so another tab does not read an older value", async () => {
    const control = installIndexedDB();
    const thisTab = committedValue("didit-auth:application");
    const otherTab = committedValue("didit-auth:application");
    await otherTab.write("older");

    control.failOpens = 1;
    await thisTab.write("newer");
    await expect(otherTab.read()).resolves.toBeUndefined();

    await thisTab.write("newest");
    await expect(otherTab.read()).resolves.toBe("newest");
  });

  it("opens IndexedDB again after the browser closed the connection", async () => {
    const control = installIndexedDB();
    const thisTab = committedValue("didit-auth:application");
    const otherTab = committedValue("didit-auth:application");
    await thisTab.write("older");

    control.loseConnections();
    await thisTab.write("newer");
    await expect(otherTab.read()).resolves.toBe("newer");
    await expect(thisTab.read()).resolves.toBe("newer");
  });

  it("reads undefined, and writes nothing, where there is no IndexedDB", async () => {
    const value = committedValue("didit-auth:application");

    await expect(value.write("tokens")).resolves.toBeUndefined();
    await expect(value.read()).resolves.toBeUndefined();
  });
});
