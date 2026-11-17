interface WebGLSignals {
  vendor: string | null;
  renderer: string | null;
  unmaskedVendor: string | null;
  unmaskedRenderer: string | null;
  version: string | null;
  shadingLanguageVersion: string | null;
  maxTextureSize: number | null;
  maxViewportDims: [number, number] | null;
  maxRenderbufferSize: number | null;
  aliasedLineWidthRange: [number, number] | null;
  aliasedPointSizeRange: [number, number] | null;
  extensions: string[];
  shaderPrecision: Record<string, string> | null;
  blocked: boolean;
}

type ShaderPrecisionSource = Pick<WebGLRenderingContext, "getShaderPrecisionFormat"> & {
  VERTEX_SHADER: number;
  FRAGMENT_SHADER: number;
  HIGH_FLOAT: number;
  MEDIUM_FLOAT: number;
  LOW_FLOAT: number;
  HIGH_INT: number;
};

// GPU-driver entropy: the same renderer string can hide different driver builds,
// and shader precision ranges differ between them.
function collectShaderPrecision(gl: ShaderPrecisionSource): Record<string, string> | null {
  if (typeof gl.getShaderPrecisionFormat !== "function") return null;
  const shaderTypes: [string, number][] = [
    ["v", gl.VERTEX_SHADER],
    ["f", gl.FRAGMENT_SHADER],
  ];
  const precisionTypes: [string, number][] = [
    ["hf", gl.HIGH_FLOAT],
    ["mf", gl.MEDIUM_FLOAT],
    ["lf", gl.LOW_FLOAT],
    ["hi", gl.HIGH_INT],
  ];
  const result: Record<string, string> = {};
  let any = false;
  for (const [shaderKey, shaderType] of shaderTypes) {
    for (const [precisionKey, precisionType] of precisionTypes) {
      try {
        const format = gl.getShaderPrecisionFormat(shaderType, precisionType);
        if (!format) continue;
        result[`${shaderKey}_${precisionKey}`] = `${format.precision},${format.rangeMin},${format.rangeMax}`;
        any = true;
      } catch {
        // skip this slot, keep the rest
      }
    }
  }
  return any ? result : null;
}

function emptySignals(blocked: boolean): WebGLSignals {
  return {
    vendor: null,
    renderer: null,
    unmaskedVendor: null,
    unmaskedRenderer: null,
    version: null,
    shadingLanguageVersion: null,
    maxTextureSize: null,
    maxViewportDims: null,
    maxRenderbufferSize: null,
    aliasedLineWidthRange: null,
    aliasedPointSizeRange: null,
    extensions: [],
    shaderPrecision: null,
    blocked,
  };
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return String(value);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function asPair(value: unknown): [number, number] | null {
  if (!value) return null;
  const arr = value as ArrayLike<unknown>;
  if (typeof arr.length !== "number" || arr.length < 2) return null;
  const a = asNumber(arr[0]);
  const b = asNumber(arr[1]);
  return a !== null && b !== null ? [a, b] : null;
}

function collect(): WebGLSignals {
  if (typeof document === "undefined") return emptySignals(true);

  let canvas: HTMLCanvasElement | OffscreenCanvas;
  if (typeof OffscreenCanvas !== "undefined") {
    canvas = new OffscreenCanvas(1, 1);
  } else {
    canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
  }

  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  try {
    // OffscreenCanvas and HTMLCanvasElement disagree about getContext overloads,
    // so funnel through `any` once at the boundary instead of fighting the TS unions.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getCtx = (id: string): any => (canvas as unknown as { getContext: (id: string) => unknown }).getContext(id);
    gl = (getCtx("webgl2") as WebGL2RenderingContext | null) || null;
    if (!gl) {
      gl = (getCtx("webgl") as WebGLRenderingContext | null) || null;
    }
    if (!gl && !(typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas)) {
      gl = (getCtx("experimental-webgl") as WebGLRenderingContext | null) || null;
    }
  } catch {
    gl = null;
  }

  if (!gl) return emptySignals(true);

  const signals = emptySignals(false);
  try {
    signals.vendor = asString(gl.getParameter(gl.VENDOR));
    signals.renderer = asString(gl.getParameter(gl.RENDERER));
    signals.version = asString(gl.getParameter(gl.VERSION));
    signals.shadingLanguageVersion = asString(gl.getParameter(gl.SHADING_LANGUAGE_VERSION));
    signals.maxTextureSize = asNumber(gl.getParameter(gl.MAX_TEXTURE_SIZE));
    signals.maxViewportDims = asPair(gl.getParameter(gl.MAX_VIEWPORT_DIMS));
    signals.maxRenderbufferSize = asNumber(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    signals.aliasedLineWidthRange = asPair(gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE));
    signals.aliasedPointSizeRange = asPair(gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE));

    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    if (debugInfo) {
      signals.unmaskedVendor = asString(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL));
      signals.unmaskedRenderer = asString(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
    }

    const exts = gl.getSupportedExtensions();
    if (exts) {
      signals.extensions = [...exts].sort();
    }

    signals.shaderPrecision = collectShaderPrecision(gl);
  } catch {
    // Partial collection is fine — keep whatever we got.
  } finally {
    try {
      const loseCtx = gl.getExtension("WEBGL_lose_context");
      if (loseCtx) loseCtx.loseContext();
    } catch {
      // ignored
    }
  }

  return signals;
}

function canonicalRendererKey(signals: WebGLSignals): string {
  const renderer = signals.unmaskedRenderer || signals.renderer || "";
  const vendor = signals.unmaskedVendor || signals.vendor || "";
  return `${vendor.toLowerCase()}|${renderer
    .toLowerCase()
    .replace(/\(0x[0-9a-f]+\)/g, "")
    .trim()}`;
}

export { canonicalRendererKey, collectShaderPrecision, collect as collectWebGLSignals, type WebGLSignals };
