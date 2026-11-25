import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { minify } from "terser";

// What each entry may weigh, minified and gzipped. The first is the package promise in the README:
// `@didit-protocol/signals` alone stays under 6 KB. The device collector is a separate file the
// core loads after itself (dist/collector.mjs), so it is not part of this number; it is reported
// below for information. The autocapture entry is opt-in.
const BUDGETS = {
  "didit-signals": 6 * 1024,
  autocapture: 4 * 1024,
};

for (const [name, budget] of Object.entries(BUDGETS)) {
  const esm = await readFile(new URL(`../dist/${name}.esm.js`, import.meta.url), "utf8");
  const { code } = await minify(esm, { module: true, format: { comments: false } });
  const size = gzipSync(code, { level: 9 }).length;
  const entry = name === "didit-signals" ? "@didit-protocol/signals" : `@didit-protocol/signals/${name}`;

  console.log(`${entry}: ${size} bytes min+gz (budget ${budget})`);
  assert.ok(size <= budget, `${entry} is ${size} bytes min+gz, over the ${budget} byte budget`);
}

const collector = await readFile(new URL("../dist/collector.mjs", import.meta.url));
console.log(`dist/collector.mjs (loaded on demand): ${gzipSync(collector, { level: 9 }).length} bytes gz, ${collector.length} bytes raw`);
