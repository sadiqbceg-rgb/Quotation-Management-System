/**
 * The test-data policy, enforced against the repository itself.
 *
 * IMPLEMENTATION_PLAN.md §20.4 and PRD §34: fixtures are obviously synthetic,
 * live only under `__fixtures__/` and `test/`, and are imported ONLY from test
 * files. An ESLint rule forbids the import; this is the belt to that pair of
 * braces, because a lint rule can be disabled inline and a build can be run
 * with `--no-verify`.
 *
 * It reads the source tree rather than exercising code, which is the only way
 * to answer "is a fixture reachable from application code?" — no amount of
 * running the application can prove a negative about what it imports.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

interface SourceFile {
  /** Repository-relative, with forward slashes, so messages are stable. */
  path: string;
  text: string;
}

/** Directories that are not source at all. */
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'dist-gas',
  'coverage',
  '.git',
  '.test-output',
  'test-results',
  'playwright-report',
  'generated',
]);

function walk(directory: string): SourceFile[] {
  if (!existsSync(directory)) return [];

  const found: SourceFile[] = [];

  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);

    if (statSync(absolute).isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry)) continue;
      found.push(...walk(absolute));
      continue;
    }

    if (!/\.(ts|tsx)$/.test(entry)) continue;
    found.push({
      path: relative(ROOT, absolute).split(sep).join('/'),
      text: readFileSync(absolute, 'utf8'),
    });
  }

  return found;
}

/** A file that ships, or could ship: not a test, not a fixture, not tooling. */
function isApplicationCode(file: SourceFile): boolean {
  if (/\.(test|spec)\.tsx?$/.test(file.path)) return false;
  if (file.path.includes('/__fixtures__/')) return false;
  if (file.path.includes('/__tests__/')) return false;
  if (file.path.startsWith('test/')) return false;
  if (file.path.startsWith('e2e/')) return false;
  if (file.path.startsWith('scripts/')) return false;
  if (file.path === 'vitest.setup.ts') return false;

  return (
    file.path.startsWith('src/') ||
    file.path.startsWith('shared/') ||
    file.path.startsWith('google-apps-script/src/')
  );
}

const ALL_FILES = [
  ...walk(join(ROOT, 'src')),
  ...walk(join(ROOT, 'shared')),
  ...walk(join(ROOT, 'google-apps-script')),
  ...walk(join(ROOT, 'test')),
  ...walk(join(ROOT, 'e2e')),
];

const APPLICATION_FILES = ALL_FILES.filter(isApplicationCode);

/**
 * The file with its comments removed.
 *
 * Every check below is about CODE. Prose that mentions a fixture, or an
 * apostrophe in "an operation's own stack", is not fixture data, and matching
 * on it produces failures nobody can act on.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** Every module specifier a file imports, static and dynamic. */
function importsOf(text: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /import\s[^'"]*from\s*['"]([^'"]+)['"]/g,
    /import\s*['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(text);
    while (match !== null) {
      if (match[1] !== undefined) specifiers.push(match[1]);
      match = pattern.exec(text);
    }
  }

  return specifiers;
}

/* -------------------------------------------------------------------------- */
/* Fixtures are not reachable from the application                            */
/* -------------------------------------------------------------------------- */

describe('the test-data policy', () => {
  it('finds application code to check, so a broken walk cannot pass silently', () => {
    // A traversal that quietly matched nothing would make every assertion below
    // vacuously true — the exact way this kind of test rots.
    expect(APPLICATION_FILES.length).toBeGreaterThan(100);
    expect(APPLICATION_FILES.some((file) => file.path === 'shared/numbering.ts')).toBe(true);
  });

  it('never imports a fixture from application code', () => {
    const offenders: string[] = [];

    for (const file of APPLICATION_FILES) {
      for (const specifier of importsOf(file.text)) {
        if (/__fixtures__|(^|\/)test\/(fakes|helpers)\//.test(specifier)) {
          offenders.push(`${file.path} imports ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('never imports a Playwright or Vitest module from application code', () => {
    // A test dependency reaching the bundle is the same failure in a different
    // shape: it means application code is doing something only a test should.
    const offenders: string[] = [];

    for (const file of APPLICATION_FILES) {
      for (const specifier of importsOf(file.text)) {
        if (/^(vitest|@playwright\/test|@testing-library\/)/.test(specifier)) {
          offenders.push(`${file.path} imports ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps every piece of fixture DATA inside __fixtures__ or test/', () => {
    /*
     * What is forbidden in application code is fixture data — a `TEST_ONLY`
     * string that could be written to a sheet or printed on a document.
     *
     * Two things are deliberately NOT forbidden, and the check distinguishes
     * them by looking only inside string literals:
     *
     *   - a `TEST_ONLY_` IDENTIFIER, such as the `TEST_ONLY_resetGlobalWindow`
     *     hook a module exports so a suite can clear its module-level state.
     *     The prefix is the point: it announces that production must not call
     *     it, and the lint rules keep it out of the bundle's entry graph.
     *   - the phrase in a COMMENT, where it is prose about a test.
     */
    const misplaced = ALL_FILES.filter((file) => {
      if (
        file.path.includes('/__fixtures__/') ||
        file.path.includes('/__tests__/') ||
        file.path.startsWith('test/') ||
        file.path.startsWith('e2e/') ||
        /\.(test|spec)\.tsx?$/.test(file.path)
      ) {
        return false;
      }

      // `'TEST_ONLY …'` or "TEST_ONLY …" or `TEST_ONLY …` — a value, not a name.
      return /['"`]\s*TEST_ONLY[^_A-Za-z]/.test(withoutComments(file.text));
    });

    expect(misplaced.map((file) => file.path)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Fixtures are obviously synthetic                                            */
/* -------------------------------------------------------------------------- */

describe('fixture data', () => {
  const fixtureFiles = ALL_FILES.filter(
    (file) => file.path.includes('/__fixtures__/') || file.path.startsWith('test/'),
  );

  it('exists, and is where the policy says it is', () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });

  it('carries the TEST_ONLY marker so a leaked value is recognisable on sight', () => {
    /*
     * The point of the prefix is what happens WHEN something leaks: a row in a
     * spreadsheet reading "TEST_ONLY Client Company" is unmistakable, where
     * "Acme Trading" would sit there for a year looking like a real client.
     */
    const withoutMarker = fixtureFiles.filter((file) => {
      if (/TEST_ONLY/.test(file.text)) return false;

      // Pure machinery — the interleaving scheduler, the clock, the temp
      // directory helper — carries no data at all, so there is nothing to mark.
      // A file is only expected to carry the marker if it names domain data in
      // a STRING, which is what would end up in a sheet or on a document.
      return /['"`][^'"`]*\b(client|company|signatory|designation)\b[^'"`]*['"`]/i.test(
        withoutComments(file.text),
      );
    });

    expect(withoutMarker.map((file) => file.path)).toEqual([]);
  });

  it('never uses the real client, person or number from the reference quotation', () => {
    /*
     * PRD §34 and the phase brief: `reference/quotation-sample.pdf` is EVIDENCE.
     * Its real client and its real number may be asserted against — Phase 08
     * measures the approved document — but must never be used as fixture data,
     * because a fixture gets written to sheets and folders.
     *
     * The number itself is the one thing that legitimately appears in both
     * places: it is the format the numbering module validates. What must not
     * appear is the real client and the real signatory.
     */
    const referencePdf = join(ROOT, 'reference', 'quotation-sample.pdf');
    if (!existsSync(referencePdf)) return;

    for (const file of fixtureFiles) {
      // Every invented name in a fixture is prefixed, so anything that looks
      // like a person or a company without the prefix is worth failing on.
      const suspicious = /(?<!TEST_ONLY[\s_])(?:Al-|Est\.|LLC|W\.L\.L)/.exec(file.text);
      expect(suspicious?.[0] ?? '', file.path).toBe('');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Nothing a test produced is committed                                        */
/* -------------------------------------------------------------------------- */

describe('test output', () => {
  it('is ignored by git', () => {
    const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');

    expect(gitignore).toContain('.test-output');
    expect(gitignore).toContain('test-results');
    expect(gitignore).toContain('playwright-report');
    expect(gitignore).toContain('coverage');
  });

  it('has never been committed', () => {
    const output = execFileSync('git', ['log', '--all', '--name-only', '--pretty=format:'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });

    const offenders = [...new Set(output.split('\n').map((line) => line.trim()))].filter((path) =>
      /^(\.test-output|test-results|playwright-report|coverage)\//.test(path),
    );

    expect(offenders).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* No credential is committed                                                  */
/* -------------------------------------------------------------------------- */

describe('test credentials', () => {
  it('are synthetic literals, never read from the environment', () => {
    /*
     * A suite that reads a password from `process.env` is a suite that can be
     * pointed at production by setting one variable. The E2E password is a
     * constant that seeds an in-memory sheet and unlocks nothing.
     */
    const testFiles = ALL_FILES.filter(
      (file) =>
        /\.(test|spec)\.tsx?$/.test(file.path) ||
        file.path.startsWith('test/') ||
        file.path.startsWith('e2e/'),
    );

    const offenders: string[] = [];
    for (const file of testFiles) {
      const matches = file.text.match(/process\.env\[?['"]?[A-Z_]*(PASSWORD|SECRET|TOKEN|KEY)/g);
      if (matches !== null) offenders.push(`${file.path}: ${matches.join(', ')}`);
    }

    expect(offenders).toEqual([]);
  });

  it('never point a test at a real deployment', () => {
    const testFiles = ALL_FILES.filter(
      (file) => file.path.startsWith('e2e/') || file.path.startsWith('test/'),
    );

    for (const file of testFiles) {
      const endpoints =
        file.text.match(/https:\/\/script\.google\.com\/macros\/s\/[^'"`\s]+/g) ?? [];

      for (const endpoint of endpoints) {
        // Every endpoint a test names must be the intercepted one, which
        // announces itself as such.
        expect(endpoint, file.path).toContain('TEST_ONLY');
      }
    }
  });
});
