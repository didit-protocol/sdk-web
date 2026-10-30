/**
 * Deterministic crypto.getRandomValues (mulberry32). The fixtures were recorded
 * against the auth service with the same generator and seed, so the SDK sends
 * byte-identical PKCE verifiers, challenges and states when a test replays them.
 */
export function seededRandomValues(seed: string): <T extends ArrayBufferView | null>(array: T) => T {
  let state = 0;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 2654435761) >>> 0;

  return (array) => {
    if (!array) return array;
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (let i = 0; i < bytes.length; i++) {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      bytes[i] = (t ^ (t >>> 14)) & 0xff;
    }
    return array;
  };
}
