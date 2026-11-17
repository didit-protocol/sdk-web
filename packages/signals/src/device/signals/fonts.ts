interface FontSignals {
  available: string[];
  count: number;
  blocked: boolean;
}

// Compact font list. Keeps the offsetWidth probe budget under ~50ms even on slow mobiles.
const FONT_CANDIDATES = [
  // Cross-platform classics
  "Arial",
  "Arial Black",
  "Arial Narrow",
  "Comic Sans MS",
  "Courier",
  "Courier New",
  "Georgia",
  "Impact",
  "Lucida Console",
  "Lucida Sans Unicode",
  "Palatino",
  "Palatino Linotype",
  "Tahoma",
  "Times",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
  "Geneva",
  "Helvetica",
  "Helvetica Neue",
  // macOS / iOS
  "Apple Color Emoji",
  "Apple SD Gothic Neo",
  "Avenir",
  "Avenir Next",
  "Baskerville",
  "Big Caslon",
  "Chalkboard",
  "Cochin",
  "Copperplate",
  "Didot",
  "Futura",
  "Gill Sans",
  "Hoefler Text",
  "Marker Felt",
  "Menlo",
  "Monaco",
  "Optima",
  "Papyrus",
  "Phosphate",
  "Savoye LET",
  "SignPainter",
  "Skia",
  "Snell Roundhand",
  "Zapfino",
  "PingFang SC",
  "PingFang TC",
  // Windows
  "Calibri",
  "Cambria",
  "Candara",
  "Consolas",
  "Constantia",
  "Corbel",
  "Ebrima",
  "Franklin Gothic",
  "Gabriola",
  "Leelawadee",
  "MS Gothic",
  "MS PGothic",
  "MS Mincho",
  "Microsoft YaHei",
  "Microsoft JhengHei",
  "Segoe UI",
  "Segoe UI Symbol",
  "Sylfaen",
  "Yu Gothic",
  // Android / Linux
  "Roboto",
  "Noto Sans",
  "Noto Sans CJK",
  "Droid Sans",
  "Droid Serif",
  "Droid Sans Mono",
  "DejaVu Sans",
  "DejaVu Serif",
  "DejaVu Sans Mono",
  "Liberation Sans",
  "Liberation Serif",
  "Liberation Mono",
  "Ubuntu",
  "Cantarell",
  "Source Sans Pro",
  "Source Code Pro",
  "Inconsolata",
  "Fira Sans",
  "Fira Code",
  // OEM-specific (Honor / Huawei / Samsung / Xiaomi etc.)
  "HOS Sans",
  "HarmonyOS Sans",
  "Samsung Sans",
  "SamsungOne",
  "MiSans",
  "OnePlus Sans",
  "MotoSans",
];

const PROBE_TEXT = "mmmmmmmmmmlli";
const PROBE_FONT_SIZE = "72px";
const BASE_FONTS = ["monospace", "sans-serif", "serif"] as const;
/**
 * Candidates laid out per pass. All the probes in one layout are one long task on a slow phone;
 * twelve candidates (36 probes) are a short one, and the main thread is handed back between passes.
 */
const BATCH_SIZE = 12;

type Yield = () => Promise<void>;

function emptySignals(blocked: boolean): FontSignals {
  return { available: [], count: 0, blocked };
}

function probe(container: HTMLElement, fontFamily: string): HTMLSpanElement {
  // One line per probe, so no probe can sit beside another on a line and change what it measures.
  const line = document.createElement("div");
  const span = document.createElement("span");
  span.style.fontSize = PROBE_FONT_SIZE;
  span.style.fontFamily = fontFamily;
  span.textContent = PROBE_TEXT;
  line.appendChild(span);
  container.appendChild(line);
  return span;
}

function sizeOf(span: HTMLSpanElement): { w: number; h: number } {
  return { w: span.offsetWidth, h: span.offsetHeight };
}

/**
 * The fonts the device has, from the size of a text in each candidate font with a base font as its
 * fallback: a candidate whose text differs from the base font's in width or height is installed.
 *
 * The probes are laid out in passes of BATCH_SIZE candidates, with `yieldToMain` between passes,
 * inside a box of their own out of view (`contain` keeps their layout and paint apart from the
 * page's). Every pass reads the base fonts again in its own layout, so each candidate is compared
 * with the base sizes of the same layout, as when all of them were laid out at once: the list is
 * the same, only the work is split.
 */
async function collectFontSignals(yieldToMain: Yield): Promise<FontSignals> {
  if (typeof document === "undefined" || !document.body) return emptySignals(true);

  let container: HTMLElement | null = null;
  try {
    container = document.createElement("div");
    container.style.cssText =
      "position:absolute;left:-9999px;top:-9999px;visibility:hidden;contain:layout style paint;";
    const baseSpans = BASE_FONTS.map((baseFont) => {
      return probe(container!, baseFont);
    });

    const available: string[] = [];
    for (let start = 0; start < FONT_CANDIDATES.length; start += BATCH_SIZE) {
      if (start > 0) await yieldToMain();
      // The page may have replaced the body's children while this waited; a detached probe reads 0.
      if (!container.isConnected) document.body.appendChild(container);
      const batch = FONT_CANDIDATES.slice(start, start + BATCH_SIZE);
      const pass = document.createElement("div");
      const candidateSpans = batch.map((candidate) => {
        return BASE_FONTS.map((baseFont) => {
          return probe(pass, `"${candidate.replace(/"/g, "")}",${baseFont}`);
        });
      });
      // Every probe of the pass is in the page before the first size is read: the browser lays
      // them out once. Reading each one right after adding it forced a layout per probe.
      container.appendChild(pass);
      const baseSizes = baseSpans.map(sizeOf);
      batch.forEach((candidate, index) => {
        const differs = candidateSpans[index].some((span, baseIndex) => {
          const base = baseSizes[baseIndex];
          return span.offsetWidth !== base.w || span.offsetHeight !== base.h;
        });
        if (differs) available.push(candidate);
      });
      container.removeChild(pass);
    }

    available.sort();
    return { available, count: available.length, blocked: false };
  } catch {
    return emptySignals(true);
  } finally {
    if (container && container.parentNode) container.parentNode.removeChild(container);
  }
}

export { BATCH_SIZE, collectFontSignals, FONT_CANDIDATES, type FontSignals };
