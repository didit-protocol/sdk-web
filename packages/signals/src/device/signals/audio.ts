interface AudioSignals {
  sum: string;
  blocked: boolean;
}

async function collectAudioSignals(): Promise<AudioSignals> {
  if (typeof window === "undefined") return { sum: "", blocked: true };
  const Ctx: typeof OfflineAudioContext | undefined =
    (window as Window & { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext ||
    (window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Ctx) return { sum: "", blocked: true };

  try {
    const ctx = new Ctx(1, 5000, 44100);
    const oscillator = ctx.createOscillator();
    oscillator.type = "triangle";
    oscillator.frequency.value = 10000;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -50;
    compressor.knee.value = 40;
    compressor.ratio.value = 12;
    compressor.attack.value = 0;
    compressor.release.value = 0.25;

    oscillator.connect(compressor);
    compressor.connect(ctx.destination);
    oscillator.start(0);

    const renderPromise = new Promise<AudioBuffer>((resolve, reject) => {
      ctx.oncomplete = (event) => resolve(event.renderedBuffer);
      const result = ctx.startRendering();
      if (result && typeof (result as Promise<AudioBuffer>).then === "function") {
        (result as Promise<AudioBuffer>).then(resolve, reject);
      }
    });

    const timeoutPromise = new Promise<AudioBuffer | null>((resolve) => {
      setTimeout(() => resolve(null), 1000);
    });

    const buf = await Promise.race([renderPromise, timeoutPromise]);
    if (!buf) return { sum: "", blocked: true };

    const channel = buf.getChannelData(0);
    let sum = 0;
    for (let i = 4500; i < channel.length; i++) {
      sum += Math.abs(channel[i]);
    }
    return { sum: sum.toFixed(8), blocked: false };
  } catch {
    return { sum: "", blocked: true };
  }
}

export { type AudioSignals, collectAudioSignals };
