import { describe, expect, it } from "@jest/globals";
import type { DeviceCollector } from "../collector";

/**
 * The local `DeviceCollector` interface (src/collector.ts) must stay assignable from the vendored
 * collector, so a change of its API fails the typecheck instead of failing in a browser.
 *
 * The check is the assignment below: `tsc --noEmit` reads the declarations vendored beside the
 * collector (`vendor/collector.d.mts`), so a collector whose API no longer fits does not compile.
 */
type Vendored = typeof import("../../vendor/collector.mjs");
const assignable: DeviceCollector = {} as Vendored;

describe("the vendored collector matches DeviceCollector", () => {
  it("is assignable at compile time", () => {
    expect(assignable).toBeDefined();
  });
});
