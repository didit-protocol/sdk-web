import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { minify } from "terser";

// The package promise: the whole of @didit-protocol/signals stays under 5 KB minified and gzipped.
const BUDGET_BYTES = 5 * 1024;

const esm = await readFile(new URL("../dist/didit-signals.esm.js", import.meta.url), "utf8");
const { code } = await minify(esm, { module: true, format: { comments: false } });
const size = gzipSync(code, { level: 9 }).length;

console.log(`@didit-protocol/signals: ${size} bytes min+gz (budget ${BUDGET_BYTES})`);
assert.ok(size <= BUDGET_BYTES, `@didit-protocol/signals is ${size} bytes min+gz, over the ${BUDGET_BYTES} byte budget`);
