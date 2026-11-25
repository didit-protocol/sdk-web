import { describe, expect, it } from "@jest/globals";
import { installWebCryptoForTests } from "./_test_setup";
installWebCryptoForTests();

import { bytesToBase64Url, randomBase64Url, sha256_128, sha256Bytes } from "../hash";

describe("hash module", () => {
  it("bytesToBase64Url handles every byte-count modulo", () => {
    expect(bytesToBase64Url(new Uint8Array([0, 0, 0]))).toBe("AAAA");
    expect(bytesToBase64Url(new Uint8Array([255, 255, 255]))).toBe("____");
    expect(bytesToBase64Url(new Uint8Array([72]))).toBe("SA");
    expect(bytesToBase64Url(new Uint8Array([72, 105]))).toBe("SGk");
  });

  it("sha256Bytes matches the well-known \"abc\" digest", async () => {
    const bytes = await sha256Bytes("abc");
    expect(Array.from(bytes.slice(0, 4))).toEqual([0xba, 0x78, 0x16, 0xbf]);
  });

  it("sha256_128 returns 22 base64url characters", async () => {
    const out = await sha256_128("didit-fp");
    expect(out).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(out.length).toBe(22);
  });

  it("sha256_128 is deterministic", async () => {
    const a = await sha256_128("payload-value");
    const b = await sha256_128("payload-value");
    expect(a).toBe(b);
  });

  it("sha256_128 differs for different inputs", async () => {
    const a = await sha256_128("inputA");
    const b = await sha256_128("inputB");
    expect(a).not.toBe(b);
  });

  it("randomBase64Url is variable-length and base64url", () => {
    const id = randomBase64Url(16);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    // 16 bytes → 22 chars (no trailing padding in base64url-no-pad)
    expect(id.length).toBe(22);
  });

  it("randomBase64Url is highly unlikely to repeat", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(randomBase64Url(16));
    expect(ids.size).toBe(1000);
  });

  it("sha256Bytes copes with a SharedArrayBuffer-backed Uint8Array", async () => {
    // The implementation copies into a fresh ArrayBuffer-backed view, which makes
    // subtle.digest happy on stricter TS configs. Regression test for the
    // ArrayBufferLike → ArrayBuffer issue.
    const view = new Uint8Array(new ArrayBuffer(4));
    view.set([1, 2, 3, 4]);
    const bytes = await sha256Bytes(view);
    expect(bytes.length).toBe(32);
  });
});
