import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { packageExtension } from './scripts/package-extension.ts';

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };

export default defineConfig({
  define: {
    __STH_VERSION__: JSON.stringify(pkg.version),
  },
  publicDir: false,
  build: {
    outDir: 'dist/sth-extension',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(root, 'src/content.ts'),
      output: {
        format: 'iife',
        name: 'sthOpsPanel',
        entryFileNames: 'content.js',
      },
    },
  },
  plugins: [
    {
      name: 'package-extension',
      apply: 'build',
      closeBundle() {
        if (process.env.VITEST) return;
        packageExtension();
      },
    },
  ],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
