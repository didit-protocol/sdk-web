import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import dts from 'rollup-plugin-dts';
import { readFileSync } from 'fs';
import { collectorAsSeparateFile, collectorInlined } from './rollup-collector.js';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'));

const banner = `/**
 * Didit signals v${packageJson.version}
 * (c) ${new Date().getFullYear()} Didit
 * @license MIT
 */`;

const plugins = () => [resolve(), typescript({ tsconfig: './tsconfig.json', declaration: false })];

// The autocapture entry reaches the core through its package name, so an app that imports both
// gets one event queue and one fingerprint, not a copy per entry.
const external = ['@didit-protocol/signals'];

/** ESM, CommonJS and type builds of one entry beside the core: `@didit-protocol/signals/<name>`. */
const entry = (name) => [
  {
    input: `src/${name}.ts`,
    external,
    output: { file: `dist/${name}.esm.js`, format: 'esm', banner, sourcemap: true },
    plugins: plugins(),
  },
  {
    input: `src/${name}.ts`,
    external,
    output: { file: `dist/${name}.cjs`, format: 'cjs', banner, sourcemap: true, exports: 'named' },
    plugins: plugins(),
  },
  {
    input: `src/${name}.ts`,
    external,
    output: { file: `dist/${name}.d.ts`, format: 'esm' },
    plugins: [dts()],
  },
];

export default [
  {
    input: 'src/index.ts',
    output: { file: 'dist/didit-signals.esm.js', format: 'esm', banner, sourcemap: true },
    plugins: [collectorAsSeparateFile(), ...plugins()],
  },
  {
    input: 'src/index.ts',
    output: { file: 'dist/didit-signals.cjs', format: 'cjs', banner, sourcemap: true, exports: 'named' },
    plugins: [collectorAsSeparateFile(), ...plugins()],
  },
  // Minified UMD build (for <script> tags): window.DiditSignals, with the collector inside.
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/didit-signals.umd.min.js',
      format: 'umd',
      name: 'DiditSignals',
      banner,
      sourcemap: true,
      exports: 'named',
      inlineDynamicImports: true,
    },
    plugins: [collectorInlined(), ...plugins(), terser()],
  },
  {
    input: 'src/index.ts',
    output: { file: 'dist/index.d.ts', format: 'esm' },
    plugins: [dts()],
  },
  ...entry('autocapture'),
];
