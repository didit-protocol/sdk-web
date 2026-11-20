import { type NavigatorSignals } from "./navigator";
import { type WebGLSignals } from "./webgl";

/**
 * Whether the page is running on emulated or virtualized hardware.
 *
 * An emulator's camera is unremarkable from inside the guest, and its user agent is that of an
 * ordinary handset. The rendering stack is what gives the guest away.
 *
 * `null` means NOT DETERMINED, never "clean": when WebGL is blocked, or answers only with
 * the browser's own placeholder strings, there is nothing to judge, and reporting `false`
 * there would let an attacker suppress the signal simply by denying or masking the probe.
 * Didit only treats an explicit `true` as a detection, so the three states stay
 * distinguishable end to end.
 */
interface EnvironmentSignals {
  emulator: boolean | null;
  virtualMachine: boolean | null;
  matchedSignatures: string[];
}

// GPU identifiers only a hypervisor's virtual adapter ever reports. No physical consumer
// GPU describes itself this way, so a match is conclusive rather than corroborating.
//
// Two strings that look like they belong here deliberately do not. "VMware, Inc." is the
// vendor Mesa reports for llvmpipe and softpipe on any Linux box, because VMware wrote
// them - only the adapter names VMware's guest driver exposes ("VMware SVGA 3D" on
// Windows guests, "SVGA3D; build: RELEASE" on Linux guests) prove a VMware guest. And
// "Microsoft Basic Render Driver" is WARP, Windows' software rasterizer, which a physical
// PC also reports over Remote Desktop or whenever its display driver is missing; it lives
// in the software-rasterizer list below and is judged the same way as SwiftShader.
const HYPERVISOR_SIGNATURES: RegExp[] = [
  /virtualbox/i,
  /vboxvga/i,
  /vmware svga/i,
  /svga3d/i,
  /parallels/i,
  /hyper-?v\b/i,
  /\bqemu\b/i,
  /\bbochs\b/i,
  /virgl/i,
  /apple paravirtual/i,
  /virtio[ _-]?gpu/i,
];

// The Android emulator's own graphics stack. "Goldfish" and "Ranchu" are the virtual
// device names its AVD images expose, and the GLES translator names itself outright.
const EMULATOR_RENDERER_SIGNATURES: RegExp[] = [/android emulator/i, /goldfish/i, /ranchu/i, /android sdk built for/i];

// Pure software rasterizers. On a desktop these are also what a browser falls back to
// when it blocklists a real GPU, or what Windows reports over Remote Desktop and when a
// display driver is missing, so alone they prove nothing and are deliberately not
// reported. Paired with a user agent claiming a phone they are conclusive: no shipping
// handset renders the web through SwiftShader, llvmpipe or a Direct3D 11 WARP adapter.
const SOFTWARE_RASTERIZER_SIGNATURES: RegExp[] = [
  /swiftshader/i,
  /llvmpipe/i,
  /softpipe/i,
  /mesa offscreen/i,
  /software rasterizer/i,
  /microsoft basic render driver/i,
];

// Emulator device models that the Android system images put in the user agent. A real
// handset never carries these, so matching one can only ever ADD a detection - a forged
// user agent hides an emulator, it cannot invent one on genuine hardware.
const EMULATOR_USER_AGENT_SIGNATURES: RegExp[] = [
  /sdk_gphone/i,
  /google_sdk/i,
  /generic_x86/i,
  /\bemulator\b/i,
  /android sdk built for/i,
];

// What a browser answers when it is withholding the driver strings rather than describing
// hardware. Firefox reports "Mozilla" for both vendor and renderer whenever the debug
// extension is unavailable or fingerprint resistance is on; Chrome and Safari report
// "WebKit" / "WebKit WebGL" for the masked pair, and older Chrome builds a bare
// "Google Inc." for the masked ANGLE vendor. None of these say anything about the machine,
// so a rendering stack made only of them is NOT DETERMINED, exactly like a blocked probe.
// Otherwise an emulator could hide its renderer behind a privacy setting and be recorded
// as explicitly clean instead of unavailable.
const MASKED_IDENTIFIERS: RegExp[] = [/^mozilla$/i, /^webkit$/i, /^webkit webgl$/i, /^google inc\.?$/i];

function matchAll(haystack: string, patterns: RegExp[]): string[] {
  const hits: string[] = [];
  for (const pattern of patterns) {
    if (pattern.test(haystack)) hits.push(pattern.source);
  }
  return hits;
}

function claimsMobileDevice(navigatorSignals: NavigatorSignals): boolean {
  if (navigatorSignals.uaDataMobile === true) return true;
  return /Android|iPhone|iPad|iPod/i.test(navigatorSignals.userAgent || "");
}

/**
 * Judge the rendering stack and the user agent for emulator / hypervisor evidence.
 *
 * Browsers expose no OS-level attestation of the machine they run on, so this raises the
 * cost of an emulator-hosted injection attack rather than making it impossible. It is
 * corroborating evidence, which is why every risk it can reach defaults to NO_ACTION.
 */
function collectEnvironmentSignals(webgl: WebGLSignals, navigatorSignals: NavigatorSignals): EnvironmentSignals {
  const userAgent = navigatorSignals.userAgent || "";
  const userAgentHits = matchAll(userAgent, EMULATOR_USER_AGENT_SIGNATURES);

  const renderStrings = [webgl.unmaskedRenderer, webgl.renderer, webgl.unmaskedVendor, webgl.vendor]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  // Signatures are matched against every string we were given - a positive is a positive
  // wherever it shows up. Only the decision between "clean" and "not determined" needs at
  // least one identifier that actually describes hardware.
  const renderStack = renderStrings.join(" | ");
  const describesHardware = renderStrings.some((value) => !MASKED_IDENTIFIERS.some((pattern) => pattern.test(value)));

  const hypervisorHits = matchAll(renderStack, HYPERVISOR_SIGNATURES);
  const emulatorHits = matchAll(renderStack, EMULATOR_RENDERER_SIGNATURES);
  const rasterizerHits = matchAll(renderStack, SOFTWARE_RASTERIZER_SIGNATURES);
  const mobileOnSoftwareRasterizer = rasterizerHits.length > 0 && claimsMobileDevice(navigatorSignals);

  const emulator = emulatorHits.length > 0 || userAgentHits.length > 0 || mobileOnSoftwareRasterizer;
  const virtualMachine = hypervisorHits.length > 0;

  return {
    // A user-agent hit is a real detection even with nothing to judge in the rendering
    // stack; absent any hit, a blocked or masked stack is "not determined", never "clean".
    emulator: emulator || describesHardware ? emulator : null,
    virtualMachine: virtualMachine || describesHardware ? virtualMachine : null,
    matchedSignatures: [
      ...new Set([
        ...emulatorHits,
        ...hypervisorHits,
        ...userAgentHits,
        ...(mobileOnSoftwareRasterizer ? rasterizerHits : []),
      ]),
    ],
  };
}

export {
  collectEnvironmentSignals,
  EMULATOR_RENDERER_SIGNATURES,
  EMULATOR_USER_AGENT_SIGNATURES,
  type EnvironmentSignals,
  HYPERVISOR_SIGNATURES,
  MASKED_IDENTIFIERS,
  SOFTWARE_RASTERIZER_SIGNATURES,
};
