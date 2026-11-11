import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import dts from 'rollup-plugin-dts';
import { readFileSync } from 'fs';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'));

const banner = `/**
 * Didit signals v${packageJson.version}
 * (c) ${new Date().getFullYear()} Didit
 * @license MIT
 */`;

const plugins = () => [resolve(), typescript({ tsconfig: './tsconfig.json', declaration: false })];

// The other entries reach the core through its package name, so an app that imports several of
// them gets one event queue and one fingerprint, not a copy per entry.
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
    plugins: plugins(),
  },
  {
    input: 'src/index.ts',
    output: { file: 'dist/didit-signals.cjs', format: 'cjs', banner, sourcemap: true, exports: 'named' },
    plugins: plugins(),
  },
  // Minified UMD build (for <script> tags): window.DiditSignals
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/didit-signals.umd.min.js',
      format: 'umd',
      name: 'DiditSignals',
      banner,
      sourcemap: true,
      exports: 'named',
    },
    plugins: [...plugins(), terser()],
  },
  {
    input: 'src/index.ts',
    output: { file: 'dist/index.d.ts', format: 'esm' },
    plugins: [dts()],
  },
  ...entry('device'),
  ...entry('autocapture'),
];
