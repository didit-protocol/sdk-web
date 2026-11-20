import { webcrypto } from "node:crypto";
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from "node:util";

/**
 * Test-only helper: install Node's WebCrypto + TextEncoder/Decoder onto
 * globalThis so jest tests running under jsdom can call ``crypto.subtle.digest``
 * (which jsdom doesn't ship by default) and ``new TextEncoder()``.
 *
 * jsdom defines ``globalThis.crypto`` as a non-configurable getter, so a
 * straight assignment throws. ``Object.defineProperty`` lets us replace the
 * binding regardless.
 */
export function installWebCryptoForTests(): void {
  const g = globalThis as typeof globalThis & {
    crypto: Crypto;
    TextDecoder: typeof TextDecoder;
    TextEncoder: typeof TextEncoder;
  };

  if (!(g.crypto && g.crypto.subtle && typeof g.crypto.subtle.digest === "function")) {
    const crypto = webcrypto as unknown as Crypto;
    try {
      Object.defineProperty(g, "crypto", {
        configurable: true,
        writable: true,
        value: crypto,
      });
    } catch {
      g.crypto = crypto;
    }
  }
  if (typeof g.TextEncoder === "undefined" || typeof g.TextDecoder === "undefined") {
    if (typeof g.TextEncoder === "undefined") g.TextEncoder = NodeTextEncoder as typeof TextEncoder;
    if (typeof g.TextDecoder === "undefined") g.TextDecoder = NodeTextDecoder as typeof TextDecoder;
  }
}
