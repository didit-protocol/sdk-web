import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";

const ROOT = process.cwd();
const SIMULATED_VERSION = "9.8.7";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function runBuild(cwd) {
  const rollup = resolve(ROOT, "node_modules/rollup/dist/bin/rollup");
  const result = spawnSync(process.execPath, [rollup, "-c"], { cwd, encoding: "utf8" });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function evaluateCommonJs(code) {
  const module = { exports: {} };

  runInNewContext(code, { exports: module.exports, module, console, URL });

  return module.exports;
}

function evaluateUmd(code) {
  const context = { console, URL };

  context.globalThis = context;
  runInNewContext(code, context);

  return context.DiditSDK;
}

async function assertBuiltVersion(root, expectedVersion) {
  const dist = resolve(root, "dist");
  const esmUrl = `${pathToFileURL(join(dist, "didit-sdk.esm.js")).href}?version=${expectedVersion}`;
  const esm = await import(esmUrl);
  const commonJs = evaluateCommonJs(await readFile(join(dist, "didit-sdk.cjs.js"), "utf8"));
  const umd = evaluateUmd(await readFile(join(dist, "didit-sdk.umd.js"), "utf8"));
  const minifiedUmd = evaluateUmd(await readFile(join(dist, "didit-sdk.umd.min.js"), "utf8"));
  const declarations = await readFile(join(dist, "index.d.ts"), "utf8");

  assert.equal(esm.SDK_VERSION, expectedVersion);
  assert.equal(commonJs.SDK_VERSION, expectedVersion);
  assert.equal(umd.SDK_VERSION, expectedVersion);
  assert.equal(minifiedUmd.SDK_VERSION, expectedVersion);
  assert.equal(
    declarations.includes(`declare const SDK_VERSION = "${expectedVersion}";`),
    true,
    "Type declaration does not contain the package version"
  );
}

async function createSimulatedBuild() {
  const root = await mkdtemp(join(tmpdir(), "sdk-web-version-"));
  const packageJson = await readJson(resolve(ROOT, "package.json"));

  packageJson.version = SIMULATED_VERSION;
  await cp(resolve(ROOT, "src"), join(root, "src"), { recursive: true });
  await cp(resolve(ROOT, "rollup.config.js"), join(root, "rollup.config.js"));
  await cp(resolve(ROOT, "tsconfig.json"), join(root, "tsconfig.json"));
  await writeFile(join(root, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  await symlink(resolve(ROOT, "node_modules"), join(root, "node_modules"), "dir");

  return root;
}

async function main() {
  const packageJson = await readJson(resolve(ROOT, "package.json"));
  const simulatedRoot = await createSimulatedBuild();

  try {
    await assertBuiltVersion(ROOT, packageJson.version);
    runBuild(simulatedRoot);
    await assertBuiltVersion(simulatedRoot, SIMULATED_VERSION);
  } finally {
    await rm(simulatedRoot, { recursive: true, force: true });
  }

  console.log(`Verified package-derived SDK_VERSION ${packageJson.version} and simulated ${SIMULATED_VERSION}.`);
}

await main();
