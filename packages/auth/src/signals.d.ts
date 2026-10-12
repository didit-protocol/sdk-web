// Declares the part of @didit-protocol/signals this package uses until the
// signals package lands in this workspace and ships its own declarations.
// Tests resolve the module to the fingerprint source it is built from
// (see jest.config.js and e2e/server.mjs).
declare module "@didit-protocol/signals" {
  export interface DeviceFingerprintPayload {
    persistentId: string;
    compositeHash: string;
  }

  export function getDeviceFingerprintPayload(): Promise<DeviceFingerprintPayload | null>;
  export function buildFingerprintHeaders(payload: DeviceFingerprintPayload | null): Record<string, string>;
}
