import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { BATCH_SIZE, collectFontSignals, FONT_CANDIDATES } from "../signals/fonts";

// jsdom lays nothing out, so a probe's size comes from its font-family: a font the device has
// renders at its own width, a missing one falls back to the base font after the comma.
const BASE_WIDTH: Record<string, number> = { monospace: 80, "sans-serif": 90, serif: 100 };
const INSTALLED = new Set(["Roboto", "Arial"]);
const PASS_COUNT = Math.ceil(FONT_CANDIDATES.length / BATCH_SIZE);
/** The base fonts' probes plus those of the pass the read belongs to. */
const probesInPass = (pass: number) => {
  return 3 + FONT_CANDIDATES.slice(pass * BATCH_SIZE, (pass + 1) * BATCH_SIZE).length * 3;
};

interface SizeRead {
  attached: boolean;
  probesInPage: number;
  pass: number;
}

const probesInPage = () => {
  return document.body.querySelectorAll("span").length;
};

const sizeOf = (span: HTMLElement) => {
  const family = span.style.fontFamily;
  const [first, fallback] = family.split(",");
  const name = first.replace(/"/g, "").trim();
  if (fallback !== undefined && INSTALLED.has(name)) return { w: 123, h: 40 };
  return { w: BASE_WIDTH[(fallback ?? first).trim()] ?? 0, h: 30 };
};

describe("collectFontSignals", () => {
  let reads: SizeRead[];
  let yields: number;
  let widthSpy: ReturnType<typeof jest.spyOn>;
  let heightSpy: ReturnType<typeof jest.spyOn>;
  const yieldToMain = jest.fn(() => {
    yields += 1;
    return Promise.resolve();
  });

  beforeEach(() => {
    reads = [];
    yields = 0;
    yieldToMain.mockClear();
    widthSpy = jest.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      reads.push({ attached: document.body.contains(this), probesInPage: probesInPage(), pass: yields });
      return sizeOf(this).w;
    });
    heightSpy = jest.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      reads.push({ attached: document.body.contains(this), probesInPage: probesInPage(), pass: yields });
      return sizeOf(this).h;
    });
  });

  afterEach(() => {
    widthSpy.mockRestore();
    heightSpy.mockRestore();
  });

  it("lists the fonts whose probe differs from a base font", async () => {
    await expect(collectFontSignals(yieldToMain)).resolves.toEqual({
      available: ["Arial", "Roboto"],
      count: 2,
      blocked: false,
    });
  });

  it("lays out the probes in passes and hands the main thread back between them", async () => {
    await collectFontSignals(yieldToMain);
    expect(PASS_COUNT).toBeGreaterThan(1);
    expect(yieldToMain).toHaveBeenCalledTimes(PASS_COUNT - 1);
    const passes = new Set(
      reads.map((read) => {
        return read.pass;
      }),
    );
    expect(passes.size).toBe(PASS_COUNT);
  });

  it("reads no size until every probe of its pass is in the page, so the browser lays each pass out once", async () => {
    await collectFontSignals(yieldToMain);
    expect(reads.length).toBeGreaterThan(0);
    expect(
      reads.filter((read) => {
        return !read.attached || read.probesInPage !== probesInPass(read.pass);
      }),
    ).toEqual([]);
  });

  it("puts its box back when the page removed it during a pause, so no probe is read detached", async () => {
    const removing = jest.fn(() => {
      yields += 1;
      Array.from(document.body.children).forEach((child) => {
        document.body.removeChild(child);
      });
      return Promise.resolve();
    });
    await expect(collectFontSignals(removing)).resolves.toEqual({
      available: ["Arial", "Roboto"],
      count: 2,
      blocked: false,
    });
    expect(
      reads.filter((read) => {
        return !read.attached;
      }),
    ).toEqual([]);
  });

  it("leaves nothing in the page", async () => {
    await collectFontSignals(yieldToMain);
    expect(probesInPage()).toBe(0);
    expect(document.body.children).toHaveLength(0);
  });
});
