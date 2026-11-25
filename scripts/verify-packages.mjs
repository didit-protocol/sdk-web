import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, resolve } from "node:path";

const root = process.cwd();
const destination = await mkdtemp(join(tmpdir(), "signals-package-"));
// Exactly what npm publishes, so a missing or stray build file fails before a release tag does.
const PUBLISHED_FILES = {
  "@didit-protocol/sdk-web": [
    "LICENSE",
    "README.md",
    "dist/didit-sdk.cjs",
    "dist/didit-sdk.cjs.js",
    "dist/didit-sdk.cjs.js.map",
    "dist/didit-sdk.cjs.map",
    "dist/didit-sdk.esm.js",
    "dist/didit-sdk.esm.js.map",
    "dist/didit-sdk.module.js",
    "dist/didit-sdk.module.js.map",
    "dist/didit-sdk.umd.js",
    "dist/didit-sdk.umd.js.map",
    "dist/didit-sdk.umd.min.js",
    "dist/didit-sdk.umd.min.js.map",
    "dist/index.d.ts",
    "package.json",
  ],
  "@didit-protocol/signals": [
    "LICENSE",
    "README.md",
    "dist/autocapture.cjs",
    "dist/autocapture.cjs.map",
    "dist/autocapture.d.ts",
    "dist/autocapture.esm.js",
    "dist/autocapture.esm.js.map",
    "dist/collector.mjs",
    "dist/didit-signals.cjs",
    "dist/didit-signals.cjs.map",
    "dist/didit-signals.esm.js",
    "dist/didit-signals.esm.js.map",
    "dist/didit-signals.umd.min.js",
    "dist/didit-signals.umd.min.js.map",
    "dist/index.d.ts",
    "package.json",
  ],
};

function run(command, args, cwd = destination) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });

  assert.equal(result.status, 0, `${command} failed: ${result.stderr}`);

  return result.stdout;
}

function pack(cwd) {
  const [archive] = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", destination], cwd));

  assert.ok(archive.files.every(({ path }) => !/recovery|__tests__|\.env|proof/.test(path)));
  if (PUBLISHED_FILES[archive.name]) {
    assert.deepEqual(archive.files.map(({ path }) => path).sort(), PUBLISHED_FILES[archive.name], `${archive.name} packs unexpected files`);
  }

  return join(destination, archive.filename);
}

/**
 * The core loads the device collector from a relative path. That file must be in the tarball
 * (a path that only exists in the working tree would break every install), and nothing may read
 * the sync state of the vendored files at runtime.
 */
async function assertCollectorShips() {
  const [archive] = JSON.parse(run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], join(root, "packages/signals")));
  const packed = new Set(archive.files.map(({ path }) => path));

  for (const file of ["dist/didit-signals.esm.js", "dist/didit-signals.cjs"]) {
    const code = await readFile(join(root, "packages/signals", file), "utf8");
    const imported = [...code.matchAll(/import\(\s*["'](\.\/[^"']+)["']\s*\)/g)].map((match) => match[1]);

    assert.deepEqual(imported, ["./collector.mjs"], `${file} must load the collector from one relative path`);
    // An archive names its members with "/" on every system; `join` would write "\\" on Windows.
    assert.ok(packed.has(posix.join("dist", imported[0])), `${file} imports ${imported[0]}, which npm pack does not include`);
    assert.ok(!code.includes("SYNC-STATE"), `${file} reads the sync state at runtime`);
  }
  assert.ok(![...packed].some((path) => path.includes("SYNC-STATE")), "the sync state is published");
  const umd = await readFile(join(root, "packages/signals/dist/didit-signals.umd.min.js"), "utf8");
  assert.ok(!/import\(\s*["']\.\//.test(umd), "the script-tag build must contain the collector, not load it");
}

try {
  await assertCollectorShips();
  const signals = pack(join(root, "packages/signals"));
  const sdk = pack(root);
  const auth = pack(join(root, "packages/auth"));
  const authReact = pack(join(root, "packages/auth-react"));
  const authNextjs = pack(join(root, "packages/auth-nextjs"));

  await writeFile(join(destination, "package.json"), '{"private":true,"type":"module"}');
  // npm also installs the peers (react, next), so `npm ls` fails if any dependency would not resolve.
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", signals, sdk, auth, authReact, authNextjs]);
  run("npm", ["ls", "--all"]);
  // auth-nextjs pins the auth and auth-react of its release: the packed copies, not a second install.
  assert.ok(!existsSync(join(destination, "node_modules/@didit-protocol/auth-nextjs/node_modules")), "auth-nextjs installs its own auth or auth-react");
  run(process.execPath, ["--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import sdk, * as web from '@didit-protocol/sdk-web';
    import * as signals from '@didit-protocol/signals';
    assert.equal(sdk, web.DiditSdk);
    assert.equal(web.submitEvent, signals.submitEvent);
    assert.equal(web.flush, signals.flush);
    assert.equal(web.getDeviceFingerprintPayload, signals.getDeviceFingerprintPayload);
    assert.equal(typeof sdk.shared.submitEvent, 'function');
    assert.equal(await signals.getDeviceFingerprintPayload(), null);
    // The other entries share the core they were installed with: one queue, one fingerprint source.
    const autocapture = await import('@didit-protocol/signals/autocapture');
    assert.equal(typeof signals.getSignalsEvidence, 'function');
    assert.equal(await signals.getSignalsEvidence(), null);
    assert.equal(typeof autocapture.startAutocapture, 'function');
    assert.equal(autocapture.defaultSanitizePath('/users/48213/orders'), '/users/:id/orders');
  `]);
  run(process.execPath, ["--input-type=commonjs", "-e", `
    const assert = require('node:assert/strict');
    const web = require('@didit-protocol/sdk-web');
    const signals = require('@didit-protocol/signals');
    assert.equal(web.submitEvent, signals.submitEvent);
    assert.equal(web.flush, signals.flush);
    assert.equal(typeof web.default.shared.submitEvent, 'function');
    assert.equal(typeof signals.getSignalsEvidence, 'function');
    assert.equal(typeof require('@didit-protocol/signals/autocapture').startAutocapture, 'function');
  `]);
  await writeFile(join(destination, "consumer.mts"), `
    import sdk, { configureEvents, flush, type DiditEvent, type DeviceFingerprintPayload } from '@didit-protocol/sdk-web';
    import { submitEvent } from '@didit-protocol/signals';
    const event: DiditEvent = { category: 'auth', actionType: 'login' };
    const id: string = submitEvent({ monitoringToken: 'example-token', event });
    configureEvents({ batchSize: 25 });
    sdk.shared.submitEvent({ monitoringToken: 'example-token', event: { ...event, eventId: id } });
    flush().then(result => result.acceptedCount);
    export const fingerprint: DeviceFingerprintPayload | null = null;
  `);
  await writeFile(join(destination, "signals-consumer.mts"), `
    import { getDeviceFingerprintPayload, getSignalsEvidence, type DeviceFingerprintPayload } from '@didit-protocol/signals';
    import { startAutocapture, track, type AutocaptureOptions } from '@didit-protocol/signals/autocapture';
    getDeviceFingerprintPayload().then((payload: DeviceFingerprintPayload | null) => payload?.evidence);
    getSignalsEvidence().then((evidence: string | null) => evidence);
    const options: AutocaptureOptions = { monitoringToken: () => null, sanitizePath: (pathname) => pathname };
    const stop: () => void = startAutocapture(options);
    track('auth', 'password_forgot', { method: 'email' });
    stop();
  `);
  // @didit-protocol/auth imports the installed signals package, so these also check the exports it needs.
  // A key the Didit auth service minted (packages/auth/src/__tests__/fixtures/publishable-keys.json).
  const { publishableKey } = JSON.parse(await readFile(join(root, "packages/auth/src/__tests__/fixtures/publishable-keys.json"), "utf8")).live;
  run(process.execPath, ["--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import { createDiditAuth, DiditAuthError } from '@didit-protocol/auth';
    import { verifyToken, DiditAuthError as ServerError } from '@didit-protocol/auth/server';
    assert.equal(ServerError, DiditAuthError);
    const auth = createDiditAuth({ publishableKey: '${publishableKey}', redirectUri: 'https://app.example.com/callback' });
    assert.equal(typeof auth.stepUp, 'function');
    assert.throws(() => createDiditAuth({ publishableKey: 'pk_live_bm90IGEgdXJs' }), (error) => error.code === 'invalid_publishable_key');
    await assert.rejects(verifyToken('not-a-token', { publishableKey: '${publishableKey}' }), (error) => error instanceof DiditAuthError && error.code === 'invalid_token');
  `]);
  run(process.execPath, ["--input-type=commonjs", "-e", `
    const assert = require('node:assert/strict');
    const { createDiditAuth, DiditAuthError } = require('@didit-protocol/auth');
    const server = require('@didit-protocol/auth/server');
    assert.equal(server.DiditAuthError, DiditAuthError);
    assert.equal(typeof createDiditAuth({ publishableKey: '${publishableKey}' }).handleStepUpCallback, 'function');
    assert.equal(typeof server.verifyToken, 'function');
  `]);
  await writeFile(join(destination, "auth-consumer.mts"), `
    import { createDiditAuth, type DiditSession, type DiditStepUpResult } from '@didit-protocol/auth';
    import { verifyToken, type DiditTokenClaims } from '@didit-protocol/auth/server';
    const auth = createDiditAuth({ publishableKey: 'pk_test_example', storage: 'session' });
    auth.getSession().then((session: DiditSession | null) => session?.vendorData);
    auth.stepUp({ action: 'payout', amount: '900.00', currency: 'USD' }).then((result: DiditStepUpResult) => result.approved);
    verifyToken('token', { publishableKey: 'pk_test_example' }).then((claims: DiditTokenClaims) => claims.sub);
  `);
  run(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--module", "nodenext", "--target", "ES2020", "consumer.mts", "signals-consumer.mts", "auth-consumer.mts"]);
  // Outside a browser the core must not load the collector at all: put a marker in the installed
  // copy and call everything that could load it.
  await writeFile(join(destination, "node_modules/@didit-protocol/signals/dist/collector.mjs"), "globalThis.__collectorLoaded = true;\nexport {};\n");
  run(process.execPath, ["--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import * as signals from '@didit-protocol/signals';
    assert.equal(await signals.getDeviceFingerprintPayload(), null);
    assert.equal(await signals.getSignalsEvidence(), null);
    assert.equal(globalThis.__collectorLoaded, undefined);
  `]);
  const standalone = await readFile(join(root, "dist/didit-sdk.esm.js"), "utf8");

  assert.ok(!standalone.includes('from "@didit-protocol/signals"') && !standalone.includes("from '@didit-protocol/signals'"));
  console.log("Packed ESM, CommonJS, SSR, shared exports and TypeScript consumers of sdk-web, signals and auth passed.");
} finally {
  await rm(destination, { recursive: true, force: true });
}
