/**
 * Bundle the TypeScript Apps Script backend into a single Code.js.
 *
 * Apps Script has no module system: every function callable by the platform
 * must be a top-level global. esbuild produces an IIFE exposing the module on
 * `globalThis`, and the footer re-exports `doPost` / `doGet` as the plain
 * function declarations Apps Script looks for.
 *
 * Output: dist-gas/Code.js  →  pushed with `clasp push`.
 */

import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const outDir = resolve(projectRoot, 'dist-gas');

await mkdir(outDir, { recursive: true });

await build({
  entryPoints: [resolve(here, 'src/main.ts')],
  outfile: resolve(outDir, 'Code.js'),
  bundle: true,
  format: 'iife',
  globalName: '__app',
  // Apps Script's V8 runtime supports ES2019. Do not raise this.
  target: 'es2019',
  platform: 'neutral',
  charset: 'utf8',
  legalComments: 'none',
  // Readable output: a human may need to inspect this in the Apps Script editor.
  minify: false,
  alias: {
    '@shared': resolve(projectRoot, 'shared'),
  },
  footer: {
    js: [
      '',
      '// Apps Script entry points — must be top-level globals.',
      'function doPost(e) { return __app.doPost(e); }',
      'function doGet(e) { return __app.doGet(e); }',
      '',
      '// Operator-only, run from the Apps Script editor. Not reachable over HTTP.',
      'function runProvisioning() { return __app.runProvisioning(); }',
      'function measurePasswordHashCost(iterations) { return __app.measurePasswordHashCost(iterations); }',
    ].join('\n'),
  },
});

await copyFile(resolve(here, 'appsscript.json'), resolve(outDir, 'appsscript.json'));

console.log('Apps Script bundle written to dist-gas/Code.js');
