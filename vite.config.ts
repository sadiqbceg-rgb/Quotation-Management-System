import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
  },
  /*
   * The test configuration and the coverage gates live in `vitest.config.ts`.
   *
   * Vitest reads that file in preference to this one and merges this config
   * into it, so the aliases and plugins above are still what tests resolve
   * against. This file is about the bundle.
   */
});
