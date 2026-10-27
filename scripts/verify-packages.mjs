import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

try {
  const signals = pack(join(root, "packages/signals"));
  const sdk = pack(root);
  const auth = pack(join(root, "packages/auth"));

  await writeFile(join(destination, "package.json"), '{"private":true,"type":"module"}');
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", signals, sdk, auth]);
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
  `]);
  run(process.execPath, ["--input-type=commonjs", "-e", `
    const assert = require('node:assert/strict');
    const web = require('@didit-protocol/sdk-web');
    const signals = require('@didit-protocol/signals');
    assert.equal(web.submitEvent, signals.submitEvent);
    assert.equal(web.flush, signals.flush);
    assert.equal(typeof web.default.shared.submitEvent, 'function');
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
  run(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--module", "nodenext", "--target", "ES2020", "consumer.mts", "auth-consumer.mts"]);
  const standalone = await readFile(join(root, "dist/didit-sdk.esm.js"), "utf8");

  assert.ok(!standalone.includes('from "@didit-protocol/signals"') && !standalone.includes("from '@didit-protocol/signals'"));
  console.log("Packed ESM, CommonJS, SSR, shared exports and TypeScript consumers of sdk-web, signals and auth passed.");
} finally {
  await rm(destination, { recursive: true, force: true });
}
