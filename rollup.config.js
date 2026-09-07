import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import dts from 'rollup-plugin-dts';
import { readFileSync } from 'fs';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'));
const versionPlaceholder = '__SDK_PACKAGE_VERSION__';

function injectPackageVersion(version) {
  return {
    name: 'inject-package-version',
    transform(code, id) {
      const normalizedId = id.replaceAll('\\', '/');

      if (!normalizedId.endsWith('/src/constants.ts')) return null;
      if (!code.includes(versionPlaceholder)) this.error('SDK version placeholder is missing');

      return { code: code.replaceAll(versionPlaceholder, version), map: null };
    },
    renderChunk(code) {
      if (!code.includes(versionPlaceholder)) return null;

      return { code: code.replaceAll(versionPlaceholder, version), map: null };
    },
  };
}

const banner = `/**
 * Didit SDK for Web v${packageJson.version}
 * (c) ${new Date().getFullYear()} Didit
 * @license MIT
 */`;

export default [
  // ESM build
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/didit-sdk.esm.js',
      format: 'esm',
      banner,
      sourcemap: true,
    },
    plugins: [
      injectPackageVersion(packageJson.version),
      resolve(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
      }),
    ],
  },
  // CommonJS build
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/didit-sdk.cjs.js',
      format: 'cjs',
      banner,
      sourcemap: true,
      exports: 'named',
    },
    plugins: [
      injectPackageVersion(packageJson.version),
      resolve(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
      }),
    ],
  },
  // UMD build (for <script> tags)
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/didit-sdk.umd.js',
      format: 'umd',
      name: 'DiditSDK',
      banner,
      sourcemap: true,
      exports: 'named',
    },
    plugins: [
      injectPackageVersion(packageJson.version),
      resolve(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
      }),
    ],
  },
  // Minified UMD build
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/didit-sdk.umd.min.js',
      format: 'umd',
      name: 'DiditSDK',
      banner,
      sourcemap: true,
      exports: 'named',
    },
    plugins: [
      injectPackageVersion(packageJson.version),
      resolve(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
      }),
      terser(),
    ],
  },
  // Type declarations
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.d.ts',
      format: 'esm',
    },
    plugins: [injectPackageVersion(packageJson.version), dts()],
  },
];
