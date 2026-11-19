import { bytesToBase64Url, sha256Bytes } from "../hash";

interface CanvasSignals {
  pngHash: string;
  chunkSketch: string[];
  blocked: boolean;
}

const CANVAS_WIDTH = 220;
const CANVAS_HEIGHT = 60;
const CHUNK_COUNT = 32;

function emptySignals(blocked: boolean): CanvasSignals {
  return { pngHash: "", chunkSketch: [], blocked };
}

async function renderToBlob(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob | null> {
  if ("convertToBlob" in canvas && typeof canvas.convertToBlob === "function") {
    try {
      return await canvas.convertToBlob({ type: "image/png" });
    } catch {
      return null;
    }
  }
  return new Promise<Blob | null>((resolve) => {
    try {
      (canvas as HTMLCanvasElement).toBlob((blob) => resolve(blob), "image/png");
    } catch {
      resolve(null);
    }
  });
}

async function collectCanvasSignals(): Promise<CanvasSignals> {
  if (typeof document === "undefined" && typeof OffscreenCanvas === "undefined") {
    return emptySignals(true);
  }

  let canvas: HTMLCanvasElement | OffscreenCanvas;
  if (typeof OffscreenCanvas !== "undefined") {
    canvas = new OffscreenCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  } else {
    canvas = document.createElement("canvas");
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
  }

  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d", { willReadFrequently: true }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
  } catch {
    ctx = null;
  }
  if (!ctx) return emptySignals(true);

  try {
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#f60";
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = "#069";
    ctx.font = '11pt "Arial"';
    ctx.fillText("Didit…fp©0", 2, 15);
    ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
    ctx.font = '18pt "Arial Unicode MS", "Apple Color Emoji", sans-serif';
    ctx.fillText("\u{1F510}\u{1F3FB}", 4, 45);

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(20, 30, 80, 30, 100, 0);
    ctx.stroke();

    ctx.globalCompositeOperation = "multiply";
    for (const { b, g, r } of [
      { b: 255, g: 0, r: 255 },
      { b: 255, g: 255, r: 0 },
      { b: 0, g: 255, r: 255 },
    ]) {
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath();
      ctx.arc(50 + r / 8, 30 + g / 8, 30, 0, 2 * Math.PI, true);
      ctx.closePath();
      ctx.fill();
    }
  } catch {
    return emptySignals(true);
  }

  let pngHash = "";
  let chunkSketch: string[] = [];

  try {
    const blob = await renderToBlob(canvas);
    if (blob) {
      const buf = new Uint8Array(await blob.arrayBuffer());
      const hashBytes = await sha256Bytes(buf);
      pngHash = bytesToBase64Url(hashBytes.slice(0, 16));
    }
  } catch {
    // pngHash stays empty
  }

  try {
    const imgData = ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT).data;
    const chunkSize = Math.max(1, Math.floor(imgData.length / CHUNK_COUNT));
    const sketches: string[] = [];
    for (let i = 0; i < CHUNK_COUNT; i++) {
      const start = i * chunkSize;
      const end = Math.min(imgData.length, start + chunkSize);
      const slice = new Uint8Array(imgData.buffer, imgData.byteOffset + start, end - start);
      const hashBytes = await sha256Bytes(slice);
      sketches.push(bytesToBase64Url(hashBytes.slice(0, 6)));
    }
    chunkSketch = sketches;
  } catch {
    // chunkSketch stays empty
  }

  return { pngHash, chunkSketch, blocked: false };
}

export { type CanvasSignals, collectCanvasSignals };
