import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { installWebCryptoForTests } from "./_test_setup";
installWebCryptoForTests();

import { COOKIE_NAME, newPersistentId, readStoredPersistentId, STORAGE_KEY, storePersistentId } from "../storage";

const ID_A = "AAAAAAAAAAAAAAAAAAAAAA";
const ID_B = "BBBBBBBBBBBBBBBBBBBBBB";

function clearAllStorage() {
  localStorage.clear();
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0].trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
}

beforeEach(clearAllStorage);
afterEach(() => {
  jest.restoreAllMocks();
});

describe("reading the id the page's two stores hold", () => {
  it("answers null and leaves the page as it was: no storage entry, no cookie", () => {
    expect(readStoredPersistentId()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(document.cookie).not.toContain(COOKIE_NAME);
  });

  it("answers the id with the stores that hold it", () => {
    localStorage.setItem(STORAGE_KEY, ID_A);
    expect(readStoredPersistentId()).toEqual({ id: ID_A, sources: ["localStorage"], wasCreated: false });

    document.cookie = `${COOKIE_NAME}=${ID_A}; Path=/`;
    expect(readStoredPersistentId()).toEqual({ id: ID_A, sources: ["localStorage", "cookie"], wasCreated: false });

    localStorage.removeItem(STORAGE_KEY);
    expect(readStoredPersistentId()).toEqual({ id: ID_A, sources: ["cookie"], wasCreated: false });
  });

  it("goes by localStorage where the two hold different ids", () => {
    localStorage.setItem(STORAGE_KEY, ID_A);
    document.cookie = `${COOKIE_NAME}=${ID_B}; Path=/`;

    expect(readStoredPersistentId()).toEqual({ id: ID_A, sources: ["localStorage"], wasCreated: false });
  });

  it("takes a stored value that is not an id for nothing", () => {
    localStorage.setItem(STORAGE_KEY, "not!a!valid!base64url");
    document.cookie = `${COOKIE_NAME}=also%21bad; Path=/`;

    expect(readStoredPersistentId()).toBeNull();
  });

  it("reads the cookie among the page's other cookies", () => {
    document.cookie = "theme=dark; Path=/";
    document.cookie = `${COOKIE_NAME}=${ID_B}; Path=/`;
    document.cookie = "didit_pid_other=ZZZZZZZZZZZZZZZZZZZZZZ; Path=/";

    expect(readStoredPersistentId()?.id).toBe(ID_B);
  });

  it("answers from the cookie where localStorage may not be read", () => {
    document.cookie = `${COOKIE_NAME}=${ID_A}; Path=/`;
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(readStoredPersistentId()).toEqual({ id: ID_A, sources: ["cookie"], wasCreated: false });
  });
});

describe("storing the id", () => {
  it("writes it to both stores", () => {
    storePersistentId(ID_A);

    expect(localStorage.getItem(STORAGE_KEY)).toBe(ID_A);
    expect(document.cookie).toContain(`${COOKIE_NAME}=${ID_A}`);
  });

  it("writes only the store that does not hold it yet", () => {
    localStorage.setItem(STORAGE_KEY, ID_A);
    const setItem = jest.spyOn(Storage.prototype, "setItem");

    storePersistentId(ID_A);

    expect(setItem).not.toHaveBeenCalled();
    expect(document.cookie).toContain(`${COOKIE_NAME}=${ID_A}`);
  });

  it("replaces another id in both", () => {
    storePersistentId(ID_A);
    storePersistentId(ID_B);

    expect(readStoredPersistentId()).toEqual({ id: ID_B, sources: ["localStorage", "cookie"], wasCreated: false });
  });

  it("still writes the cookie where localStorage refuses", () => {
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    storePersistentId(ID_A);

    expect(document.cookie).toContain(`${COOKIE_NAME}=${ID_A}`);
  });
});

describe("making up an id", () => {
  it("gives a new id every time, marked as created and stored nowhere", () => {
    const first = newPersistentId();
    const second = newPersistentId();

    expect(first.id).toMatch(/^[A-Za-z0-9_-]{20,32}$/);
    expect(first.id).not.toBe(second.id);
    expect(first).toMatchObject({ sources: ["fresh"], wasCreated: true });
    expect(readStoredPersistentId()).toBeNull();
  });
});
