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
  /*
   * DEV SERVER ONLY. This has no effect on `vite build` or on anything served
   * in production.
   *
   * Vite 6 validates the Host header and refuses any name it does not
   * recognise — an anti-DNS-rebinding measure, on by default. A Codespaces
   * forwarded URL arrives as `<codespace>-5173.app.github.dev`, which Vite
   * rejects with a 403 "Blocked request" even though the server is healthy and
   * `curl http://localhost:5173/` returns 200.
   *
   * The leading dot allows the domain and its subdomains, so this keeps working
   * when a Codespace is renamed or rebuilt. It is deliberately narrow: `true`
   * would disable host checking altogether and reintroduce the rebinding risk
   * the default exists to prevent.
   */
  server: {
    allowedHosts: ['.app.github.dev'],
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
