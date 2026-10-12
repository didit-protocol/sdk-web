import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const destination = await mkdtemp(join(tmpdir(), "signals-package-"));

function run(command, args, cwd = destination) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });

  assert.equal(result.status, 0, `${command} failed: ${result.stderr}`);

  return result.stdout;
}

function pack(cwd) {
  const [archive] = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", destination], cwd));

  assert.ok(archive.files.every(({ path }) => !/recovery|__tests__|\.env|proof/.test(path)));

  return join(destination, archive.filename);
}

try {
  const signals = pack(join(root, "packages/signals"));
  const sdk = pack(root);

  await writeFile(join(destination, "package.json"), '{"private":true,"type":"module"}');
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", signals, sdk]);
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
  run(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--module", "nodenext", "--target", "ES2020", "consumer.mts"]);
  const standalone = await readFile(join(root, "dist/didit-sdk.esm.js"), "utf8");

  assert.ok(!standalone.includes('from "@didit-protocol/signals"') && !standalone.includes("from '@didit-protocol/signals'"));
  console.log("Packed ESM, CommonJS, SSR, shared exports and TypeScript consumers passed.");
} finally {
  await rm(destination, { recursive: true, force: true });
}
