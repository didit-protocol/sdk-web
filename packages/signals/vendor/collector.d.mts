interface AudioSignals {
    sum: string;
    blocked: boolean;
}

interface CanvasSignals {
    pngHash: string;
    chunkSketch: string[];
    blocked: boolean;
}

interface CodecSignals {
    media: Record<string, string>;
    recorder: Record<string, boolean>;
    blocked: boolean;
}

interface FontSignals {
    available: string[];
    count: number;
    blocked: boolean;
}

interface HardwareSignals {
    batteryLevelQuantized: number | null;
    batteryCharging: boolean | null;
    mediaDevicesKinds: Record<string, number>;
    speechSynthesisVoices: number | null;
    storageQuota: number | null;
    storageUsage: number | null;
}

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

interface NavigatorSignals {
    userAgent: string;
    userAgentNormalized: string;
    platform: string;
    language: string;
    languages: string[];
    hardwareConcurrency: number | null;
    hardwareConcurrencyQuantized: number | null;
    deviceMemory: number | null;
    maxTouchPoints: number | null;
    devicePixelRatio: number | null;
    screenWidth: number | null;
    screenHeight: number | null;
    availWidth: number | null;
    availHeight: number | null;
    colorDepth: number | null;
    pixelDepth: number | null;
    orientation: string | null;
    timeZone: string;
    connectionEffectiveType: string | null;
    connectionDownlink: number | null;
    uaDataMobile: boolean | null;
    uaDataPlatform: string | null;
    uaDataBrands: string[];
    cookieEnabled: boolean | null;
    doNotTrack: string | null;
}

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

type WebViewKind = "browser" | "whatsapp" | "gsa" | "instagram" | "facebook" | "messenger" | "tiktok" | "line" | "wechat" | "telegram" | "twitter" | "linkedin" | "snapchat" | "generic-wv";
interface WebViewSignals {
    kind: WebViewKind;
    hostAppVersion: string | null;
    isStandaloneBrowser: boolean;
}

declare const COMPOSITE_HASH_VERSION = 4;

interface DeviceSignals {
    platform: "web";
    tier: "lite" | "full";
    compositeHashVersion: typeof COMPOSITE_HASH_VERSION;
    navigator: NavigatorSignals;
    webview: WebViewSignals;
    embedder?: {
        persistentId: string;
    };
}
interface FullDeviceSignals extends DeviceSignals {
    tier: "full";
    canvas: CanvasSignals;
    webgl: WebGLSignals;
    audio: AudioSignals;
    fonts: FontSignals;
    math: MathSignals;
    apiBitmap: string;
    apiMissing: string[];
    hardware: HardwareSignals;
    codecs: CodecSignals;
}
interface DeviceFingerprintPayload<S extends DeviceSignals = DeviceSignals> {
    version: 2;
    schema: "didit-fp-v2";
    platform: "web";
    collectedAt: string;
    persistentId: string;
    persistentIdSources: string[];
    persistentIdWasCreated: boolean;
    signals: S;
    compositeHash: string;
    legacyCompatibilityHash?: string;
}
type FullDeviceFingerprintPayload = DeviceFingerprintPayload<FullDeviceSignals>;
interface FingerprintPayload extends FullDeviceFingerprintPayload {
    evidence: string;
}

interface BuildOptions {
    budgetMs?: number;
    embedderPersistentId?: string | null;
    newPersistentId?: string | null;
    durableId?: boolean;
}

interface CleanRealm {
    window: (Window & typeof globalThis) | null;
    close: () => void;
}

interface NativeTarget {
    name: string;
    expectedFnName: string;
    resolve: () => unknown;
    getter?: boolean;
}
interface NativeVerdict {
    flags: string[];
    toStringSpoofed: boolean;
    verifierIndependent: boolean;
    checkedCount: number;
    blocked: boolean;
}
interface VerifyNativeOptions {
    realm?: CleanRealm;
}

declare const version: string;
declare function collect(options?: Pick<BuildOptions, "embedderPersistentId" | "newPersistentId" | "durableId">): Promise<FingerprintPayload>;
declare function peek(): FingerprintPayload | null;
declare function evidence(): string;
declare function verifyNative(targets: NativeTarget[], options?: VerifyNativeOptions): NativeVerdict;

export { collect, evidence, peek, verifyNative, version };
export type { BuildOptions, FingerprintPayload, NativeTarget, NativeVerdict, VerifyNativeOptions };
