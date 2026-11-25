import { beforeEach, describe, expect, it } from "@jest/globals";
import { installWebCryptoForTests } from "./_test_setup";
installWebCryptoForTests();

import {
  COOKIE_NAME,
  loadOrCreatePersistentId,
  readStoredPersistentId,
  resetPersistentIdForTesting,
  STORAGE_KEY,
} from "../storage";

function clearAllStorage() {
  try {
    localStorage.clear();
  } catch {
    // ignored
  }
  // Wipe every cookie defined on the page
  try {
    for (const part of document.cookie.split(";")) {
      const eq = part.indexOf("=");
      const name = (eq > -1 ? part.substring(0, eq) : part).trim();
      if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
    }
  } catch {
    // ignored
  }
}

describe("stored id in localStorage and a cookie", () => {
  beforeEach(() => {
    clearAllStorage();
    resetPersistentIdForTesting();
  });

  it("creates a fresh persistent_id when no storage layer has it", async () => {
    const result = await loadOrCreatePersistentId();
    expect(result.wasCreated).toBe(true);
    expect(result.id).toMatch(/^[A-Za-z0-9_-]{20,32}$/);
  });

  it("self-heals into every available storage layer on first run", async () => {
    const result = await loadOrCreatePersistentId();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(result.id);
    expect(document.cookie).toContain(`${COOKIE_NAME}=${result.id}`);
  });

  it("recovers the same persistent_id from localStorage on the second call", async () => {
    const first = await loadOrCreatePersistentId();
    resetPersistentIdForTesting();
    const second = await loadOrCreatePersistentId();
    expect(second.id).toBe(first.id);
    expect(second.wasCreated).toBe(false);
    expect(second.sources).toContain("localStorage");
  });

  it("rejects malformed values stored under our key", async () => {
    localStorage.setItem(STORAGE_KEY, "not!a!valid!base64url");
    document.cookie = `${COOKIE_NAME}=also%21bad; Path=/`;
    const result = await loadOrCreatePersistentId();
    expect(result.wasCreated).toBe(true);
    expect(result.id).not.toBe("not!a!valid!base64url");
  });

  it("falls back to memory when localStorage and cookie are wiped between calls", async () => {
    const first = await loadOrCreatePersistentId();
    clearAllStorage();
    // Don't reset the memory cache — that's exactly the recovery path we test.
    const second = await loadOrCreatePersistentId();
    expect(second.id).toBe(first.id);
    expect(second.wasCreated).toBe(false);
    expect(second.sources).toContain("memory");
  });

  it("two independent simulated tabs (no shared memory cache) recover the same id from localStorage", async () => {
    const first = await loadOrCreatePersistentId();
    resetPersistentIdForTesting();
    const second = await loadOrCreatePersistentId();
    expect(second.id).toBe(first.id);
  });
});

describe("asking for the stored id without creating one", () => {
  beforeEach(() => {
    clearAllStorage();
    resetPersistentIdForTesting();
  });

  it("answers null and leaves the page as it was: no storage entry, no cookie", () => {
    expect(readStoredPersistentId()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(document.cookie).not.toContain(COOKIE_NAME);
  });

  it("answers the id the page keeps, from localStorage or from the cookie alone", () => {
    const { id } = loadOrCreatePersistentId();
    expect(readStoredPersistentId()).toBe(id);

    localStorage.removeItem(STORAGE_KEY);
    expect(readStoredPersistentId()).toBe(id);
  });

  it("answers null for a stored value that is not an id", () => {
    localStorage.setItem(STORAGE_KEY, "not an id");
    expect(readStoredPersistentId()).toBeNull();
  });
});
