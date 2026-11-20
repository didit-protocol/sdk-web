interface MathSignals {
  tan_1e300: string;
  sin_1e300: string;
  cos_1e300: string;
  atan2_1_2: string;
  acosh_big: string;
  asinh_big: string;
  expm1_1: string;
  log_big: string;
  exp_1: string;
}

function probe(fn: () => number): string {
  try {
    const value = fn();
    if (Number.isFinite(value)) return value.toString();
    return String(value);
  } catch {
    return "error";
  }
}

function collectMathSignals(): MathSignals {
  return {
    tan_1e300: probe(() => Math.tan(-1e300)),
    sin_1e300: probe(() => Math.sin(-1e300)),
    cos_1e300: probe(() => Math.cos(-1e300)),
    atan2_1_2: probe(() => Math.atan2(1, 2)),
    acosh_big: probe(() => Math.acosh(1e308)),
    asinh_big: probe(() => Math.asinh(1)),
    expm1_1: probe(() => Math.expm1(1)),
    log_big: probe(() => Math.log(1e154)),
    exp_1: probe(() => Math.exp(1)),
  };
}

export { collectMathSignals, type MathSignals };
