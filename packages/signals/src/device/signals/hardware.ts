interface HardwareSignals {
  batteryLevelQuantized: number | null;
  batteryCharging: boolean | null;
  mediaDevicesKinds: Record<string, number>;
  speechSynthesisVoices: number | null;
  storageQuota: number | null;
  storageUsage: number | null;
}

function quantizeBattery(level: number | null): number | null {
  if (level === null) return null;
  if (!Number.isFinite(level)) return null;
  return Math.round(level * 5) / 5; // 0, 0.2, 0.4, 0.6, 0.8, 1.0
}

async function collectHardwareSignals(): Promise<HardwareSignals> {
  const result: HardwareSignals = {
    batteryLevelQuantized: null,
    batteryCharging: null,
    mediaDevicesKinds: {},
    speechSynthesisVoices: null,
    storageQuota: null,
    storageUsage: null,
  };

  if (typeof navigator !== "undefined") {
    const getBattery = (navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> })
      .getBattery;
    if (typeof getBattery === "function") {
      try {
        const battery = await getBattery.call(navigator);
        result.batteryLevelQuantized = quantizeBattery(battery.level);
        result.batteryCharging = battery.charging;
      } catch {
        // ignored
      }
    }

    if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === "function") {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        for (const device of devices) {
          result.mediaDevicesKinds[device.kind] = (result.mediaDevicesKinds[device.kind] || 0) + 1;
        }
      } catch {
        // ignored
      }
    }

    const storage = (navigator as Navigator & { storage?: { estimate?: () => Promise<StorageEstimate> } }).storage;
    if (storage && typeof storage.estimate === "function") {
      try {
        const estimate = await storage.estimate();
        result.storageQuota = typeof estimate.quota === "number" ? estimate.quota : null;
        result.storageUsage = typeof estimate.usage === "number" ? estimate.usage : null;
      } catch {
        // ignored
      }
    }
  }

  if (typeof speechSynthesis !== "undefined" && typeof speechSynthesis.getVoices === "function") {
    try {
      result.speechSynthesisVoices = speechSynthesis.getVoices().length;
    } catch {
      // ignored
    }
  }

  return result;
}

export { collectHardwareSignals, type HardwareSignals };
