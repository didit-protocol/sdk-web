import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { minify } from "terser";

// What each entry may weigh, minified and gzipped. The first is the package promise in the README:
// `@didit-protocol/signals` alone stays under 6 KB. It was 5 KB while it carried its own reduced
// fingerprint; it now shares every line with the full one (src/device), which costs about 0.7 KB
// and means there is one implementation to keep right. The other entries are opt-in.
const BUDGETS = {
  "didit-signals": 6 * 1024,
  device: 12 * 1024,
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
