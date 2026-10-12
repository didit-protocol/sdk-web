import { describe, expect, it } from "@jest/globals";

import { codeChallenge, decodeText, fromBase64Url, randomString, toBase64Url } from "../encoding";

describe("PKCE", () => {
  it("derives the RFC 7636 appendix B S256 challenge", async () => {
    await expect(codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).resolves.toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  });

  it("draws verifiers and states the API accepts", () => {
    const verifier = randomString(32);

    // service-didit-auth: code_verifier matches [A-Za-z0-9._~-]{43,128}.
    expect(verifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    expect(randomString(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(randomString(32)).not.toBe(verifier);
  });
});

describe("base64url", () => {
  it("round-trips every remainder length without padding", () => {
    for (const length of [0, 1, 2, 3, 4, 31, 32, 64]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 251) % 256);
      const encoded = toBase64Url(bytes);

      expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(Array.from(fromBase64Url(encoded))).toEqual(Array.from(bytes));
    }
  });

  it("decodes UTF-8 text", () => {
    expect(decodeText(Buffer.from('{"name":"Ñandú"}').toString("base64url"))).toBe('{"name":"Ñandú"}');
  });

  it("refuses the standard alphabet, padding and impossible lengths", () => {
    expect(() => fromBase64Url("ab+c")).toThrow(TypeError);
    expect(() => fromBase64Url("ab/c")).toThrow(TypeError);
    expect(() => fromBase64Url("abc=")).toThrow(TypeError);
    expect(() => fromBase64Url("abcde")).toThrow(TypeError);
  });
});
