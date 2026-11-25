import { describe, it } from "@jest/globals";

/**
 * The local `DeviceCollector` interface (src/collector.ts) must stay assignable from the vendored
 * collector, so a change of its API fails the typecheck instead of failing in a browser.
 *
 * TODO: TypeScript does not find types for `vendor/collector.mjs` yet (it looks for a
 * `collector.d.mts` beside it, and the vendored declarations are named `collector.d.ts`). When a
 * sync vendors `collector.d.mts`, replace the empty test below with this body, so `tsc --noEmit`
 * covers the check:
 *
 *   import type { DeviceCollector } from "../collector";
 *   type Vendored = typeof import("../../vendor/collector.mjs");
 *   const assignable: DeviceCollector = {} as Vendored;
 *   void assignable;
 */
describe("the vendored collector matches DeviceCollector", () => {
  it.skip("is checked at compile time once the vendored declarations are found (see the TODO above)", () => undefined);
});
