const API_PROBES: { name: string; check: () => boolean }[] = [
  { name: "SharedArrayBuffer", check: () => typeof SharedArrayBuffer !== "undefined" },
  { name: "WebAssembly", check: () => typeof WebAssembly !== "undefined" },
  { name: "WebGL2RenderingContext", check: () => typeof WebGL2RenderingContext !== "undefined" },
  { name: "OffscreenCanvas", check: () => typeof OffscreenCanvas !== "undefined" },
  { name: "ImageBitmapRenderingContext", check: () => typeof ImageBitmapRenderingContext !== "undefined" },
  { name: "BroadcastChannel", check: () => typeof BroadcastChannel !== "undefined" },
  {
    name: "PaymentRequest",
    check: () => typeof (globalThis as { PaymentRequest?: unknown }).PaymentRequest !== "undefined",
  },
  {
    name: "PresentationRequest",
    check: () => typeof (globalThis as { PresentationRequest?: unknown }).PresentationRequest !== "undefined",
  },
  { name: "Bluetooth", check: () => typeof navigator !== "undefined" && "bluetooth" in navigator },
  { name: "USB", check: () => typeof navigator !== "undefined" && "usb" in navigator },
  { name: "NDEFReader", check: () => typeof (globalThis as { NDEFReader?: unknown }).NDEFReader !== "undefined" },
  {
    name: "GravitySensor",
    check: () => typeof (globalThis as { GravitySensor?: unknown }).GravitySensor !== "undefined",
  },
  {
    name: "LinearAccelerationSensor",
    check: () => typeof (globalThis as { LinearAccelerationSensor?: unknown }).LinearAccelerationSensor !== "undefined",
  },
  { name: "Gyroscope", check: () => typeof (globalThis as { Gyroscope?: unknown }).Gyroscope !== "undefined" },
  { name: "Magnetometer", check: () => typeof (globalThis as { Magnetometer?: unknown }).Magnetometer !== "undefined" },
  {
    name: "AmbientLightSensor",
    check: () => typeof (globalThis as { AmbientLightSensor?: unknown }).AmbientLightSensor !== "undefined",
  },
  {
    name: "Bluetooth.requestDevice",
    check: () =>
      typeof navigator !== "undefined" &&
      !!(navigator as Navigator & { bluetooth?: { requestDevice?: unknown } }).bluetooth?.requestDevice,
  },
  { name: "Notification", check: () => typeof Notification !== "undefined" },
  { name: "PushManager", check: () => typeof PushManager !== "undefined" },
  { name: "ServiceWorker", check: () => typeof navigator !== "undefined" && "serviceWorker" in navigator },
  { name: "WebShare", check: () => typeof navigator !== "undefined" && typeof navigator.share === "function" },
  { name: "Clipboard", check: () => typeof navigator !== "undefined" && !!navigator.clipboard },
  {
    name: "Credentials",
    check: () => typeof navigator !== "undefined" && !!(navigator as Navigator & { credentials?: unknown }).credentials,
  },
  { name: "Geolocation", check: () => typeof navigator !== "undefined" && !!navigator.geolocation },
  { name: "MediaDevices", check: () => typeof navigator !== "undefined" && !!navigator.mediaDevices },
  {
    name: "MediaSession",
    check: () =>
      typeof navigator !== "undefined" && !!(navigator as Navigator & { mediaSession?: unknown }).mediaSession,
  },
  {
    name: "Permissions",
    check: () => typeof navigator !== "undefined" && !!(navigator as Navigator & { permissions?: unknown }).permissions,
  },
  {
    name: "Storage",
    check: () => typeof navigator !== "undefined" && !!(navigator as Navigator & { storage?: unknown }).storage,
  },
  {
    name: "StorageManager.estimate",
    check: () =>
      typeof navigator !== "undefined" &&
      typeof (navigator as Navigator & { storage?: { estimate?: unknown } }).storage?.estimate === "function",
  },
  {
    name: "Battery",
    check: () =>
      typeof navigator !== "undefined" &&
      typeof (navigator as Navigator & { getBattery?: unknown }).getBattery === "function",
  },
  { name: "IndexedDB", check: () => typeof indexedDB !== "undefined" },
  {
    name: "IDBFactory.databases",
    check: () =>
      typeof indexedDB !== "undefined" &&
      typeof (indexedDB as IDBFactory & { databases?: unknown }).databases === "function",
  },
  { name: "Cache", check: () => typeof caches !== "undefined" },
  {
    name: "WebRTC",
    check: () => typeof (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection !== "undefined",
  },
  { name: "WebSocket", check: () => typeof WebSocket !== "undefined" },
  {
    name: "WebGPU",
    check: () => typeof navigator !== "undefined" && !!(navigator as Navigator & { gpu?: unknown }).gpu,
  },
  { name: "WebTransport", check: () => typeof (globalThis as { WebTransport?: unknown }).WebTransport !== "undefined" },
  { name: "WebCodecs", check: () => typeof (globalThis as { VideoEncoder?: unknown }).VideoEncoder !== "undefined" },
  { name: "Audio.OfflineAudioContext", check: () => typeof OfflineAudioContext !== "undefined" },
  {
    name: "Audio.AudioContext",
    check: () =>
      typeof AudioContext !== "undefined" ||
      typeof (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext !== "undefined",
  },
  { name: "Intl", check: () => typeof Intl !== "undefined" },
  { name: "Intl.RelativeTimeFormat", check: () => typeof Intl !== "undefined" && !!Intl.RelativeTimeFormat },
  {
    name: "Intl.ListFormat",
    check: () => typeof Intl !== "undefined" && !!(Intl as { ListFormat?: unknown }).ListFormat,
  },
  { name: "Intl.Segmenter", check: () => typeof Intl !== "undefined" && !!(Intl as { Segmenter?: unknown }).Segmenter },
  { name: "PerformanceObserver", check: () => typeof PerformanceObserver !== "undefined" },
  { name: "IntersectionObserver", check: () => typeof IntersectionObserver !== "undefined" },
  { name: "ResizeObserver", check: () => typeof ResizeObserver !== "undefined" },
  { name: "FileReader", check: () => typeof FileReader !== "undefined" },
  { name: "TextEncoder", check: () => typeof TextEncoder !== "undefined" },
  { name: "TextDecoder", check: () => typeof TextDecoder !== "undefined" },
  {
    name: "WebKitMutationObserver",
    check: () => typeof (globalThis as { WebKitMutationObserver?: unknown }).WebKitMutationObserver !== "undefined",
  },
  { name: "navigator.connection", check: () => typeof navigator !== "undefined" && "connection" in navigator },
  { name: "navigator.userAgentData", check: () => typeof navigator !== "undefined" && "userAgentData" in navigator },
  { name: "navigator.deviceMemory", check: () => typeof navigator !== "undefined" && "deviceMemory" in navigator },
  { name: "navigator.hid", check: () => typeof navigator !== "undefined" && "hid" in navigator },
  { name: "navigator.serial", check: () => typeof navigator !== "undefined" && "serial" in navigator },
  {
    name: "navigator.virtualKeyboard",
    check: () => typeof navigator !== "undefined" && "virtualKeyboard" in navigator,
  },
  { name: "navigator.wakeLock", check: () => typeof navigator !== "undefined" && "wakeLock" in navigator },
  {
    name: "navigator.windowControlsOverlay",
    check: () => typeof navigator !== "undefined" && "windowControlsOverlay" in navigator,
  },
  { name: "navigator.xr", check: () => typeof navigator !== "undefined" && "xr" in navigator },
  { name: "MediaSource", check: () => typeof MediaSource !== "undefined" },
  {
    name: "ManagedMediaSource",
    check: () => typeof (globalThis as { ManagedMediaSource?: unknown }).ManagedMediaSource !== "undefined",
  },
  { name: "EyeDropper", check: () => typeof (globalThis as { EyeDropper?: unknown }).EyeDropper !== "undefined" },
  {
    name: "FileSystemHandle",
    check: () => typeof (globalThis as { FileSystemHandle?: unknown }).FileSystemHandle !== "undefined",
  },
  {
    name: "showOpenFilePicker",
    check: () => typeof (globalThis as { showOpenFilePicker?: unknown }).showOpenFilePicker === "function",
  },
];

function collectApiBitmap(): { hex: string; missing: string[] } {
  const bytes: number[] = [];
  const missing: string[] = [];
  for (let i = 0; i < API_PROBES.length; i += 8) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit++) {
      const idx = i + bit;
      if (idx >= API_PROBES.length) break;
      let present = false;
      try {
        present = !!API_PROBES[idx].check();
      } catch {
        present = false;
      }
      if (present) byte |= 1 << bit;
      else missing.push(API_PROBES[idx].name);
    }
    bytes.push(byte);
  }
  return {
    hex: bytes.map((b) => b.toString(16).padStart(2, "0")).join(""),
    missing,
  };
}

export { API_PROBES, collectApiBitmap };
