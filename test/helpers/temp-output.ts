/**
 * TEST ONLY — the git-ignored directory generated artefacts are written to.
 *
 * A test that wants to keep a real PDF or DOCX around for inspection writes it
 * here and nowhere else. `.gitignore` excludes the whole tree, so nothing a
 * test produces can be committed by accident (Phase 13, Security Requirements).
 *
 * Node-only: it touches the file system. Importable from `*.test.ts` only.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Ignored by `.gitignore`. Never inside `src/`, `dist/` or `public/`. */
export const TEST_OUTPUT_ROOT = join(process.cwd(), '.test-output');

/**
 * Create (or reuse) a named sub-directory of the test output root.
 *
 * The name is restricted so a caller cannot escape the root with `..` — a test
 * helper that can write anywhere is a test helper that will one day overwrite
 * something in `src/`.
 */
export function testOutputDir(name: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) {
    throw new Error(
      `testOutputDir("${name}"): expected a lowercase kebab-case name of 1-64 characters.`,
    );
  }

  const directory = join(TEST_OUTPUT_ROOT, name);
  mkdirSync(directory, { recursive: true });
  return directory;
}

/** Write bytes into a named output directory and return the path written. */
export function writeTestOutput(directory: string, fileName: string, bytes: Uint8Array): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(fileName)) {
    throw new Error(`writeTestOutput("${fileName}"): expected a plain file name, with no path.`);
  }

  const path = join(directory, fileName);
  writeFileSync(path, bytes);
  return path;
}

/** Remove a named output directory. Safe when it was never created. */
export function clearTestOutput(name: string): void {
  rmSync(testOutputDir(name), { recursive: true, force: true });
}
