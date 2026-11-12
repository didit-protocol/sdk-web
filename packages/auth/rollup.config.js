import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';
import { readFileSync } from 'fs';

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

const banner = `/**
 * Didit Authentication for Web v${packageJson.version}
 * (c) ${new Date().getFullYear()} Didit
 * @license MIT
 */`;

// The browser entry and the /server entry share the error class and the key
// parser through one chunk, so `instanceof DiditAuthError` holds across both.
const input = { index: 'src/index.ts', server: 'src/server/index.ts' };
const external = Object.keys(packageJson.dependencies ?? {});

export default [
  {
    input,
    external,
    output: [
      {
        dir: 'dist',
        format: 'esm',
        entryFileNames: '[name].mjs',
        chunkFileNames: '[name]-[hash].mjs',
        banner,
        sourcemap: true,
      },
      {
        dir: 'dist',
        format: 'cjs',
        entryFileNames: '[name].cjs',
        chunkFileNames: '[name]-[hash].cjs',
        exports: 'named',
        banner,
        sourcemap: true,
      },
    ],
    plugins: [
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
      }),
    ],
  },
  {
    input,
    external,
    output: {
      dir: 'dist',
      format: 'esm',
      entryFileNames: '[name].d.ts',
      chunkFileNames: '[name]-[hash].d.ts',
    },
    plugins: [dts()],
  },
];
