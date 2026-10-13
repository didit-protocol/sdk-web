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
];
