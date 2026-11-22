import { describe, expect, it } from "@jest/globals";
import { collectShaderPrecision } from "../signals/webgl";

function stubGl(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    HIGH_FLOAT: 36338,
    MEDIUM_FLOAT: 36337,
    LOW_FLOAT: 36336,
    HIGH_INT: 36341,
    getShaderPrecisionFormat: (_shader: number, precision: number) => ({
      precision: precision === 36338 ? 23 : 10,
      rangeMin: 127,
      rangeMax: 127,
    }),
    ...overrides,
    // The stub only needs the members collectShaderPrecision touches.
  } as unknown as Parameters<typeof collectShaderPrecision>[0];
}

describe("collectShaderPrecision", () => {
  it("encodes precision,rangeMin,rangeMax per shader/precision slot", () => {
    const result = collectShaderPrecision(stubGl());
    expect(result).not.toBeNull();
    expect(Object.keys(result!).sort()).toEqual(["f_hf", "f_hi", "f_lf", "f_mf", "v_hf", "v_hi", "v_lf", "v_mf"]);
    expect(result!.v_hf).toBe("23,127,127");
    expect(result!.v_mf).toBe("10,127,127");
  });

  it("returns null when the API is missing", () => {
    expect(collectShaderPrecision(stubGl({ getShaderPrecisionFormat: undefined }))).toBeNull();
  });

  it("returns null when every slot returns null format", () => {
    expect(collectShaderPrecision(stubGl({ getShaderPrecisionFormat: () => null }))).toBeNull();
  });

  it("keeps the slots that succeed when one throws", () => {
    const flaky = stubGl({
      getShaderPrecisionFormat: (shader: number, precision: number) => {
        if (precision === 36341) throw new Error("no ints");
        return { precision: 23, rangeMin: shader === 35633 ? 127 : 62, rangeMax: 127 };
      },
    });
    const result = collectShaderPrecision(flaky);
    expect(result).not.toBeNull();
    expect(result!.v_hi).toBeUndefined();
    expect(result!.f_hf).toBe("23,62,127");
  });
});
