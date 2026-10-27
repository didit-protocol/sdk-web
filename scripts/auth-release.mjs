// Checks an auth-v* tag before .github/workflows/release-auth.yml publishes
// @didit-protocol/auth, auth-react and auth-nextjs at the tag's version.
//
//   node scripts/auth-release.mjs auth-v0.1.0 [--notes release-notes.md] [--check-registry]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Publish order: each package only depends on the ones before it.
export const AUTH_PACKAGES = [
  { name: "@didit-protocol/auth", dir: "packages/auth" },
  { name: "@didit-protocol/auth-react", dir: "packages/auth-react" },
  { name: "@didit-protocol/auth-nextjs", dir: "packages/auth-nextjs" },
];

const DEPENDENCY_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"];
// Specs an installer cannot resolve from the registry.
const LOCAL_SPEC = /^(workspace|file|link|portal|git(\+[a-z]+)?|github):|^\.{0,2}\//;

export function versionFromTag(tag) {
  const match = /^auth-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag ?? "");

  if (!match) {
    throw new Error(`${tag} is not an auth-v<version> tag`);
  }

  return match[1];
}

export function changelogSection(changelog, version) {
  const lines = changelog.split("\n");
  const heading = `## [${version}]`;
  const start = lines.findIndex(line => line.startsWith(heading));

  if (start === -1) {
    return "";
  }

  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));

  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n").trim();
}

// Returns every problem with releasing `packages` ({ name, manifest, changelog }) at `version`.
export function releaseProblems(packages, version) {
  const problems = [];
  const releasing = new Set(packages.map(({ name }) => name));

  for (const { name, manifest, changelog } of packages) {
    if (manifest.name !== name) {
      problems.push(`expected ${name} but package.json is named ${manifest.name}`);
    }
    if (manifest.version !== version) {
      problems.push(`${name} has version ${manifest.version} but the tag says ${version}`);
    }
    if (manifest.private) {
      problems.push(`${name} is private`);
    }
    if (!changelogSection(changelog, version)) {
      problems.push(`${name} CHANGELOG.md has no section for ${version}`);
    }
    for (const field of DEPENDENCY_FIELDS) {
      for (const [dependency, spec] of Object.entries(manifest[field] ?? {})) {
        if (LOCAL_SPEC.test(spec)) {
          problems.push(`${name} ${field} has ${dependency}@${spec}, which the registry cannot resolve`);
        } else if (field === "dependencies" && releasing.has(dependency) && spec !== version) {
          problems.push(`${name} depends on ${dependency}@${spec} but this release publishes ${version}`);
        }
      }
    }
  }

  return problems;
}

// Dependencies this release does not publish, which must already be on npm: [{ name, spec }].
export function externalDidit(packages) {
  const releasing = new Set(packages.map(({ name }) => name));
  const external = new Map();

  for (const { manifest } of packages) {
    for (const field of DEPENDENCY_FIELDS) {
      for (const [dependency, spec] of Object.entries(manifest[field] ?? {})) {
        if (dependency.startsWith("@didit-protocol/") && !releasing.has(dependency)) {
          external.set(`${dependency}@${spec}`, { name: dependency, spec });
        }
      }
    }
  }

  return [...external.values()];
}

export function releaseNotes(packages, version) {
  return packages
    .map(({ name, changelog }) => `## ${name} ${version}\n\n${changelogSection(changelog, version)}\n`)
    .join("\n");
}

export function readPackages(root) {
  return AUTH_PACKAGES.map(({ name, dir }) => ({
    name,
    manifest: JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")),
    changelog: readFileSync(join(root, dir, "CHANGELOG.md"), "utf8"),
  }));
}

function publishedVersion(name, spec) {
  try {
    return execFileSync("npm", ["view", `${name}@${spec}`, "version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [tag, ...options] = process.argv.slice(2);
  const version = versionFromTag(tag);
  const packages = readPackages(process.cwd());
  const problems = releaseProblems(packages, version);

  if (options.includes("--check-registry")) {
    for (const { name, spec } of externalDidit(packages)) {
      if (!publishedVersion(name, spec)) {
        problems.push(`no published ${name} matches ${spec}: release it first`);
      }
    }
  }
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }

  const notes = options.indexOf("--notes");

  if (notes !== -1) {
    writeFileSync(options[notes + 1], releaseNotes(packages, version));
  }
  console.log(`${AUTH_PACKAGES.map(({ name }) => name).join(", ")} are ready to release at ${version}.`);
}
