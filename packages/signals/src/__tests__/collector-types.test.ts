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

/**
 * The interface must also refuse a collector that fits less: one whose payload may come without
 * the evidence, or may be the lite one. Each line below has to be a type error; the day the
 * interface accepts such a collector, `@ts-expect-error` itself stops compiling.
 */
type VendoredPayload = Awaited<ReturnType<Vendored["collect"]>>;
type CollectorReturning<Payload> = Omit<Vendored, "collect" | "peek"> & {
  collect: () => Promise<Payload>;
  peek: () => Payload | null;
};
type MaybeWithoutEvidence = Omit<VendoredPayload, "evidence"> & { evidence?: string };
type MaybeLite = Omit<VendoredPayload, "signals"> & {
  signals: Omit<VendoredPayload["signals"], "tier"> & { tier: "lite" | "full" };
};

// @ts-expect-error - the collector's payload always carries the evidence
const withoutEvidence: DeviceCollector = {} as CollectorReturning<MaybeWithoutEvidence>;
// @ts-expect-error - the collector's payload is the full one
const maybeLite: DeviceCollector = {} as CollectorReturning<MaybeLite>;

describe("the vendored collector matches DeviceCollector", () => {
  it("is assignable at compile time, and a collector that fits less is not", () => {
    expect([assignable, withoutEvidence, maybeLite]).toHaveLength(3);
  });
});
