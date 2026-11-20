interface CodecSignals {
  media: Record<string, string>;
  recorder: Record<string, boolean>;
  blocked: boolean;
}

// Fixed probe lists: proprietary codec availability (H.264/HEVC/AAC) separates
// browser builds, OS media stacks, and stripped-down webviews that share a UA.
const MEDIA_PROBES: string[] = [
  'video/mp4; codecs="avc1.42E01E"',
  'video/mp4; codecs="hvc1.1.6.L93.90"',
  'video/mp4; codecs="av01.0.04M.08"',
  'video/webm; codecs="vp8"',
  'video/webm; codecs="vp9"',
  'video/webm; codecs="av01.0.04M.08"',
  'video/ogg; codecs="theora"',
  "audio/mpeg",
  'audio/mp4; codecs="mp4a.40.2"',
  'audio/ogg; codecs="vorbis"',
  'audio/ogg; codecs="opus"',
  'audio/webm; codecs="opus"',
  "audio/flac",
  'audio/wav; codecs="1"',
];

const RECORDER_PROBES: string[] = [
  "video/webm;codecs=vp8",
  "video/webm;codecs=vp9",
  "video/webm;codecs=av1",
  "video/mp4;codecs=avc1",
  "video/mp4;codecs=hvc1",
  "audio/webm;codecs=opus",
  "audio/mp4;codecs=mp4a.40.2",
];

function collectCodecSignals(): CodecSignals {
  if (typeof document === "undefined") return { media: {}, recorder: {}, blocked: true };

  // Acquire each capability accessor inside its own guard and reuse the captured
  // callable. A hostile page can install a THROWING getter on
  // HTMLMediaElement.prototype.canPlayType or on globalThis.MediaRecorder; if that
  // read happened bare, collectCodecSignals() would throw synchronously and take
  // the whole (synchronously-composed) fingerprint payload down with it — letting
  // the exact tampered environment these signals exist to observe suppress itself.
  const media: Record<string, string> = {};
  let canPlayType: ((type: string) => string) | null = null;
  try {
    const probe = document.createElement("video");
    const fn = probe.canPlayType; // may invoke a booby-trapped prototype getter
    if (typeof fn === "function") {
      canPlayType = (type: string) => fn.call(probe, type);
    }
  } catch {
    canPlayType = null;
  }
  if (canPlayType) {
    for (const type of MEDIA_PROBES) {
      try {
        // A patched canPlayType can RETURN a hostile value (e.g. a BigInt) instead
        // of throwing. The TS annotation does no runtime coercion, so storing it
        // verbatim would later make JSON.stringify throw and lose the whole payload.
        // Accept only the spec results; map anything else to a safe error marker.
        const value: unknown = canPlayType(type);
        media[type] = value === "" || value === "maybe" || value === "probably" ? value : "error";
      } catch {
        media[type] = "error";
      }
    }
  }

  const recorder: Record<string, boolean> = {};
  let isTypeSupported: ((type: string) => boolean) | null = null;
  try {
    const Recorder = (globalThis as { MediaRecorder?: { isTypeSupported?: (type: string) => boolean } }).MediaRecorder;
    const fn = Recorder?.isTypeSupported; // may invoke a booby-trapped getter
    if (Recorder && typeof fn === "function") {
      isTypeSupported = (type: string) => !!fn.call(Recorder, type);
    }
  } catch {
    isTypeSupported = null;
  }
  if (isTypeSupported) {
    for (const type of RECORDER_PROBES) {
      try {
        recorder[type] = isTypeSupported(type);
      } catch {
        recorder[type] = false;
      }
    }
  }

  const blocked = Object.keys(media).length === 0 && Object.keys(recorder).length === 0;
  return { media, recorder, blocked };
}

export { type CodecSignals, collectCodecSignals, MEDIA_PROBES, RECORDER_PROBES };
