// jsdom has no TextEncoder or SubtleCrypto; use Node's, as browsers ship both.
// crypto is a plain object so tests can make getRandomValues deterministic.
import { webcrypto } from "node:crypto";
import { TextDecoder, TextEncoder } from "node:util";

Object.assign(globalThis, { TextEncoder, TextDecoder });

if (typeof window !== "undefined") {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      subtle: webcrypto.subtle,
      getRandomValues: <T extends ArrayBufferView | null>(array: T): T => webcrypto.getRandomValues(array as never),
      randomUUID: () => webcrypto.randomUUID()
    }
  });
}
