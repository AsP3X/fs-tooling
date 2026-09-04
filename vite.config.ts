import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { packageExtension } from './scripts/package-extension.ts';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/sth-extension',
    emptyOutDir: true,
    cssCodeSplit: false,
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
