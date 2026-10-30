import assert from "node:assert/strict";
import { test } from "node:test";
import { changelogSection, externalDidit, readPackages, releaseNotes, releaseProblems, versionFromTag } from "./auth-release.mjs";

const CHANGELOG = "# Changelog\n\n## [0.2.0] - 2026-12-01\n\n- Later.\n\n## [0.1.0] - 2026-10-27\n\n### Added\n- First.\n";

function release(overrides = {}) {
  return [
    { name: "@didit-protocol/auth", manifest: { name: "@didit-protocol/auth", version: "0.1.0", dependencies: { "@didit-protocol/signals": "^0.1.0" } }, changelog: CHANGELOG },
    { name: "@didit-protocol/auth-react", manifest: { name: "@didit-protocol/auth-react", version: "0.1.0", peerDependencies: { "@didit-protocol/auth": ">=0.1.0", react: "^19.0.0" } }, changelog: CHANGELOG },
    {
      name: "@didit-protocol/auth-nextjs",
      manifest: { name: "@didit-protocol/auth-nextjs", version: "0.1.0", dependencies: { "@didit-protocol/auth": "0.1.0", "@didit-protocol/auth-react": "0.1.0" }, ...overrides },
      changelog: CHANGELOG,
    },
  ];
}

test("reads the version from an auth-v tag only", () => {
  assert.equal(versionFromTag("auth-v0.1.0"), "0.1.0");
  assert.equal(versionFromTag("auth-v1.2.3-beta.1"), "1.2.3-beta.1");
  assert.throws(() => versionFromTag("v0.1.0"));
  assert.throws(() => versionFromTag("signals-v0.1.0"));
  assert.throws(() => versionFromTag("auth-v0.1"));
});

test("reads one version's changelog section", () => {
  assert.equal(changelogSection(CHANGELOG, "0.1.0"), "### Added\n- First.");
  assert.equal(changelogSection(CHANGELOG, "0.2.0"), "- Later.");
  assert.equal(changelogSection(CHANGELOG, "0.3.0"), "");
  assert.equal(changelogSection("## [0.1.0] - 2026-10-27\n\n", "0.1.0"), "");
});

test("accepts three packages at the tag's version", () => {
  assert.deepEqual(releaseProblems(release(), "0.1.0"), []);
});

test("refuses a tag that does not match every package", () => {
  assert.deepEqual(releaseProblems(release(), "0.2.0"), [
    "@didit-protocol/auth has version 0.1.0 but the tag says 0.2.0",
    "@didit-protocol/auth-react has version 0.1.0 but the tag says 0.2.0",
    "@didit-protocol/auth-nextjs has version 0.1.0 but the tag says 0.2.0",
    "@didit-protocol/auth-nextjs depends on @didit-protocol/auth@0.1.0 but this release publishes 0.2.0",
    "@didit-protocol/auth-nextjs depends on @didit-protocol/auth-react@0.1.0 but this release publishes 0.2.0",
  ]);
});

test("refuses a package without a changelog section", () => {
  const packages = release();
  packages[1].changelog = "# Changelog\n\n## [Unreleased]\n\n- Soon.\n";

  assert.deepEqual(releaseProblems(packages, "0.1.0"), ["@didit-protocol/auth-react CHANGELOG.md has no section for 0.1.0"]);
});

test("refuses dependencies the registry cannot resolve", () => {
  for (const spec of ["workspace:*", "file:../auth", "link:../auth", "../auth", "github:didit-protocol/sdk-web"]) {
    assert.deepEqual(
      releaseProblems(release({ dependencies: { "@didit-protocol/auth": spec, "@didit-protocol/auth-react": "0.1.0" } }), "0.1.0"),
      [`@didit-protocol/auth-nextjs dependencies has @didit-protocol/auth@${spec}, which the registry cannot resolve`],
    );
  }
  assert.deepEqual(
    releaseProblems(release({ peerDependencies: { next: "workspace:^" } }), "0.1.0"),
    ["@didit-protocol/auth-nextjs peerDependencies has next@workspace:^, which the registry cannot resolve"],
  );
});

test("refuses a range on a package of the same release", () => {
  assert.deepEqual(
    releaseProblems(release({ dependencies: { "@didit-protocol/auth": "^0.1.0", "@didit-protocol/auth-react": "0.1.0" } }), "0.1.0"),
    ["@didit-protocol/auth-nextjs depends on @didit-protocol/auth@^0.1.0 but this release publishes 0.1.0"],
  );
});

test("lists the Didit packages that must already be published", () => {
  assert.deepEqual(externalDidit(release()), [{ name: "@didit-protocol/signals", spec: "^0.1.0" }]);
});

test("writes one set of notes in publish order", () => {
  assert.equal(
    releaseNotes(release(), "0.1.0"),
    [
      "## @didit-protocol/auth 0.1.0\n\n### Added\n- First.\n",
      "## @didit-protocol/auth-react 0.1.0\n\n### Added\n- First.\n",
      "## @didit-protocol/auth-nextjs 0.1.0\n\n### Added\n- First.\n",
    ].join("\n"),
  );
});

test("the packages in this repository are ready to release at their version", () => {
  const packages = readPackages(process.cwd());
  const [{ manifest }] = packages;

  assert.deepEqual(releaseProblems(packages, manifest.version), []);
});
