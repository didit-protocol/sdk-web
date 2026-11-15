import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { collectAudioSignals } from "../signals/audio";

/**
 * Regression guard for the failure mode documented in
 * https://blog.laserphile.com/2026/08/aliexpress-webpage-keeping-multipoint.html:
 * fingerprinting with a live AudioContext graph connected to destination keeps the
 * device's audio output path active (breaking e.g. Bluetooth multipoint switching).
 * Our audio signal must only ever render on OfflineAudioContext, which never
 * touches the real output device.
 */
describe("audio fingerprint output-path safety", () => {
  afterEach(() => {
    delete (window as Window & { AudioContext?: unknown }).AudioContext;
    delete (window as Window & { webkitAudioContext?: unknown }).webkitAudioContext;
    delete (window as Window & { OfflineAudioContext?: unknown }).OfflineAudioContext;
  });

  it("never constructs a live AudioContext, even when one is available", async () => {
    const liveCtor = jest.fn();
    (window as Window & { AudioContext?: unknown }).AudioContext = liveCtor;
    (window as Window & { webkitAudioContext?: unknown }).webkitAudioContext = liveCtor;

    class FakeOfflineAudioContext {
      oncomplete: ((event: { renderedBuffer: unknown }) => void) | null = null;
      destination = {};
      createOscillator() {
        return { type: "", frequency: { value: 0 }, connect: () => undefined, start: () => undefined };
      }
      createDynamicsCompressor() {
        return {
          threshold: { value: 0 },
          knee: { value: 0 },
          ratio: { value: 0 },
          attack: { value: 0 },
          release: { value: 0 },
          connect: () => undefined,
        };
      }
      startRendering() {
        return Promise.resolve({
          getChannelData: () => new Float32Array(5000).fill(0.001),
        });
      }
    }
    (window as Window & { OfflineAudioContext?: unknown }).OfflineAudioContext = FakeOfflineAudioContext;

    const result = await collectAudioSignals();
    expect(result.blocked).toBe(false);
    // Same float32 accumulation the collector performs over samples 4500..4999.
    const channel = new Float32Array(5000).fill(0.001);
    let expected = 0;
    for (let i = 4500; i < channel.length; i++) expected += Math.abs(channel[i]);
    expect(result.sum).toBe(expected.toFixed(8));
    expect(liveCtor).not.toHaveBeenCalled();
  });

  it("reports blocked without touching AudioContext when OfflineAudioContext is missing", async () => {
    const liveCtor = jest.fn();
    (window as Window & { AudioContext?: unknown }).AudioContext = liveCtor;

    const result = await collectAudioSignals();
    expect(result.blocked).toBe(true);
    expect(liveCtor).not.toHaveBeenCalled();
  });
});
