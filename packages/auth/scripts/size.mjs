// Bundles each entry on its own, minified like an application bundler would,
// and fails when its gzipped size passes the budget. @didit-protocol/signals
// is a dependency, so it is measured by its own package.
import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { rollup } from "rollup";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const BUDGETS = [
  { name: "@didit-protocol/auth", input: "src/index.ts", limit: 10 * 1024 },
  { name: "@didit-protocol/auth/server", input: "src/server/index.ts", limit: 4 * 1024 }
];

let failed = false;

for (const { name, input, limit } of BUDGETS) {
  const bundle = await rollup({
    input,
    external: Object.keys(packageJson.dependencies ?? {}),
    plugins: [typescript({ tsconfig: "./tsconfig.json", declaration: false, outDir: undefined }), terser()]
  });
  const { output } = await bundle.generate({ format: "esm" });
  await bundle.close();
  const code = output.map((chunk) => (chunk.type === "chunk" ? chunk.code : "")).join("");
  const size = gzipSync(code, { level: 9 }).length;

  failed ||= size > limit;
  console.log(`${size > limit ? "FAIL" : "ok  "} ${name}: ${(size / 1024).toFixed(2)} KB min+gz (budget ${limit / 1024} KB)`);
}
process.exit(failed ? 1 : 0);
