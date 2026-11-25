import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// The source imports the device collector under this name (src/collector.ts). It is not a package:
// the plugins below decide what it means for each build.
const COLLECTOR_NAME = 'didit-signals-collector';
const COLLECTOR_FILE = 'collector.mjs';
const vendored = fileURLToPath(new URL(`./vendor/${COLLECTOR_FILE}`, import.meta.url));

/**
 * Package builds (ESM, CJS): the collector stays a separate file, loaded on demand. The import
 * becomes a relative path and the vendored file is copied next to the build, so the core stays
 * small and the file is part of the published package.
 */
export function collectorAsSeparateFile() {
  return {
    name: 'collector-as-separate-file',
    resolveId(id) {
      return id === COLLECTOR_NAME ? { id: `./${COLLECTOR_FILE}`, external: true } : null;
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: COLLECTOR_FILE, source: readFileSync(vendored) });
    },
  };
}

/**
 * Script-tag builds (UMD) and standalone ESM builds: one self-contained file, so the collector is
 * part of it. Needs `inlineDynamicImports: true` on the output.
 */
export function collectorInlined() {
  return {
    name: 'collector-inlined',
    resolveId(id) {
      return id === COLLECTOR_NAME ? vendored : null;
    },
  };
}
