#!/usr/bin/env node
/**
 * Verify what is about to be deployed.
 *
 * ---------------------------------------------------------------------------
 * WHY A SEPARATE SCRIPT AND NOT JUST A TEST
 * ---------------------------------------------------------------------------
 * `src/security/deployment-security.test.ts` asserts most of this already, and
 * it runs in CI. But the thing being protected here is the ARTEFACT, and the
 * artefact is what an operator uploads — sometimes from a machine, at a moment,
 * where the test suite was not the last thing that ran.
 *
 * So this is a gate that can be pointed at a `dist/` directly, exits non-zero
 * with an actionable message, and is cheap enough to run immediately before
 * every deploy. `RUNBOOK.md` makes it a required step.
 *
 * Usage:
 *   node scripts/verify-build.ts            # verifies ./dist
 *   node scripts/verify-build.ts <dir>
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

/* -------------------------------------------------------------------------- */
/* What must never ship                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Every Script Property name.
 *
 * Not the values — those are unknowable here. The NAME appearing in the bundle
 * means frontend code is reaching for a backend secret, which is the mistake
 * that precedes leaking one.
 */
const SCRIPT_PROPERTY_NAMES = [
  'SESSION_HMAC_SECRET',
  'PASSWORD_PEPPER',
  'DRIVE_ROOT_FOLDER_ID',
  'TRACKING_SPREADSHEET_ID',
  'ALLOWED_ORIGINS',
  'BOOTSTRAP_ADMIN_EMAIL',
  'BOOTSTRAP_ADMIN_PASSWORD',
  'REVOKED_TOKEN_IDS',
];

/** A long random-looking run assigned to something named like a secret. */
const CREDENTIAL_SHAPED =
  /(secret|pepper|password|apikey|api_key|private_key|access_token)\s*[:=]\s*["'][A-Za-z0-9+/_-]{16,}["']/i;

/**
 * Markers that mean a development or test build was shipped.
 *
 * `TEST_ONLY` is the project's own prefix for synthetic data. Anything carrying
 * it has no business in an artefact a client's quotation is produced from.
 *
 * A bare `localhost` is deliberately NOT on this list. React Router carries
 * `let s = "http://localhost"` as its fallback when `window.location` is
 * unavailable, so scanning for the string flags every build for a line of
 * vendor code — a check that cries wolf is a check that gets skipped.
 * `endpointFailures` below catches the mistake that actually happens instead.
 */
const DEVELOPMENT_MARKERS = ['TEST_ONLY', 'vite/modulepreload-polyfill.js?t='];

/**
 * Every backend endpoint baked into the bundle.
 *
 * The real deployment mistake is a `.env.local` left in place, which bakes a
 * development or intercepted endpoint into a production build; the app then
 * talks to a machine that is not there, or to the wrong deployment entirely.
 */
const ENDPOINT_PATTERN = /https?:\/\/[^"'`\s]*\/macros\/s\/[^"'`\s]*/g;

export function endpointFailures(fileName: string, text: string): Failure[] {
  const failures: Failure[] = [];

  for (const endpoint of text.match(ENDPOINT_PATTERN) ?? []) {
    if (!endpoint.startsWith('https://script.google.com/macros/s/')) {
      failures.push({
        check: 'backend endpoint',
        detail: `${fileName} calls ${endpoint}, which is not an Apps Script HTTPS endpoint`,
      });
      continue;
    }

    if (/TEST_ONLY|localhost|127\.0\.0\.1|example/i.test(endpoint)) {
      failures.push({
        check: 'backend endpoint',
        detail: `${fileName} points at a non-production deployment: ${endpoint}`,
      });
    }
  }

  return failures;
}

/** Text-bearing outputs only. The letterhead and the fonts are binaries. */
const TEXT_FILE = /\.(js|css|html|json|txt|map)$/;

interface Artefact {
  path: string;
  name: string;
  bytes: number;
  text: string | null;
}

function walk(directory: string): Artefact[] {
  const found: Artefact[] = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      found.push(...walk(path));
      continue;
    }

    found.push({
      path,
      name: entry,
      bytes: statSync(path).size,
      text: TEXT_FILE.test(entry) ? readFileSync(path, 'utf8') : null,
    });
  }

  return found;
}

/* -------------------------------------------------------------------------- */
/* Checks                                                                     */
/* -------------------------------------------------------------------------- */

export interface Failure {
  check: string;
  detail: string;
}

export function checkArtefacts(artefacts: readonly Artefact[]): Failure[] {
  const failures: Failure[] = [];
  const text = artefacts.filter((file): file is Artefact & { text: string } => file.text !== null);

  if (text.length === 0) {
    failures.push({
      check: 'artefacts present',
      detail: 'No text-bearing files found. Is this a build directory?',
    });
    return failures;
  }

  for (const file of text) {
    for (const name of SCRIPT_PROPERTY_NAMES) {
      if (file.text.includes(name)) {
        failures.push({ check: 'no Script Property name', detail: `${name} in ${file.name}` });
      }
    }

    const credential = CREDENTIAL_SHAPED.exec(file.text);
    if (credential !== null) {
      // The MATCH is not printed: it is the thing being protected.
      failures.push({
        check: 'nothing credential-shaped',
        detail: `a credential-shaped assignment in ${file.name}`,
      });
    }

    for (const marker of DEVELOPMENT_MARKERS) {
      if (file.text.includes(marker)) {
        failures.push({ check: 'no development marker', detail: `${marker} in ${file.name}` });
      }
    }

    failures.push(...endpointFailures(file.name, file.text));

    if (file.name.endsWith('.map')) {
      failures.push({
        check: 'no source map',
        detail: `${file.name} publishes the backend contract and the source`,
      });
    }
  }

  /* ---- the entry point ---------------------------------------------------- */

  const index = artefacts.find((file) => file.name === 'index.html');
  if (index === undefined || index.text === null) {
    failures.push({ check: 'entry point', detail: 'index.html is missing' });
  } else {
    const inline = index.text.match(/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/gi) ?? [];
    if (inline.length > 0) {
      // `script-src 'self'` with no hash and no nonce means one inline script
      // leaves the app broken in production — which is how a CSP gets removed.
      failures.push({
        check: 'no inline script',
        detail: `index.html carries ${String(inline.length)} inline <script>, which the CSP refuses`,
      });
    }
  }

  /* ---- the security headers ---------------------------------------------- */

  if (!artefacts.some((file) => file.name === '_headers')) {
    failures.push({
      check: 'security headers',
      detail: '_headers is not in the build — the deployed site would have no CSP',
    });
  }

  /* ---- hashed filenames --------------------------------------------------- */

  const unhashed = artefacts.filter(
    (file) => /\.(js|css)$/.test(file.name) && !/-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(file.name),
  );
  if (unhashed.length > 0) {
    // Without a content hash the long-lived cache headers are unsafe: a user
    // keeps last month's bundle until they clear their cache.
    failures.push({
      check: 'hashed asset filenames',
      detail: `not content-hashed: ${unhashed.map((file) => file.name).join(', ')}`,
    });
  }

  return failures;
}

/* -------------------------------------------------------------------------- */
/* The size report                                                            */
/* -------------------------------------------------------------------------- */

export interface SizeReport {
  totalBytes: number;
  javascriptBytes: number;
  entryBytes: number;
  /** The lazily-loaded document generators, which must NOT be in the entry. */
  lazyChunks: Array<{ name: string; bytes: number }>;
}

export function sizeReport(artefacts: readonly Artefact[]): SizeReport {
  const javascript = artefacts.filter((file) => file.name.endsWith('.js'));

  // Vite names the entry `index-<hash>.js`.
  const entry = javascript.find((file) => /^index-[A-Za-z0-9_-]+\.js$/.test(file.name));

  return {
    totalBytes: artefacts.reduce((sum, file) => sum + file.bytes, 0),
    javascriptBytes: javascript.reduce((sum, file) => sum + file.bytes, 0),
    entryBytes: entry?.bytes ?? 0,
    lazyChunks: javascript
      .filter((file) => /^(pdf-generator|docx-generator)-/.test(file.name))
      .map((file) => ({ name: file.name, bytes: file.bytes })),
  };
}

/**
 * The document generators must be their own chunks.
 *
 * `pdf-lib` and `docx` together are well over a megabyte, and most sessions
 * never generate a document. In the entry bundle that weight is paid by every
 * user on every page load, including the login screen.
 */
export function checkLazyLoading(report: SizeReport): Failure[] {
  const failures: Failure[] = [];

  const has = (prefix: string): boolean =>
    report.lazyChunks.some((chunk) => chunk.name.startsWith(prefix));

  if (!has('pdf-generator')) {
    failures.push({
      check: 'lazy document modules',
      detail: 'the PDF generator is not a separate chunk — pdf-lib is in the entry bundle',
    });
  }
  if (!has('docx-generator')) {
    failures.push({
      check: 'lazy document modules',
      detail: 'the DOCX generator is not a separate chunk — docx is in the entry bundle',
    });
  }

  return failures;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

function kilobytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/* -------------------------------------------------------------------------- */
/* Production environment                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What can and cannot be checked automatically.
 *
 * CAN: that a production build declares `VITE_APP_ENV=production`, and that the
 * endpoint it carries is a single HTTPS Apps Script `/exec` URL.
 *
 * CANNOT: whether that endpoint is the PRODUCTION deployment or the
 * development one. Both are `https://script.google.com/macros/s/<opaque>/exec`
 * and the ids carry no marker distinguishing them — Google does not encode the
 * environment anywhere in the URL.
 *
 * Guessing would be worse than not checking: a heuristic that is wrong once
 * either blocks a correct deploy or waves through the wrong endpoint while
 * appearing to have verified it. So this refuses to guess, and RUNBOOK.md §3
 * carries the manual step of comparing the built endpoint against the
 * deployment id in Manage deployments.
 */
export function checkProductionEnvironment(
  artefacts: readonly Artefact[],
  env: Record<string, string | undefined>,
): Failure[] {
  const failures: Failure[] = [];

  // Only enforced when the caller says this is a production build. A developer
  // running `npm run deploy:check` locally must not be blocked.
  if (env['VITE_APP_ENV'] !== 'production') return failures;

  const endpoints = new Set<string>();
  for (const file of artefacts) {
    if (file.text === null) continue;
    for (const endpoint of file.text.match(ENDPOINT_PATTERN) ?? []) endpoints.add(endpoint);
  }

  if (endpoints.size === 0) {
    failures.push({
      check: 'production endpoint',
      detail:
        'VITE_APP_ENV is production but the bundle carries no Apps Script endpoint. Set VITE_GAS_ENDPOINT in the host environment before building.',
    });
    return failures;
  }

  if (endpoints.size > 1) {
    failures.push({
      check: 'production endpoint',
      detail: `the bundle carries ${String(endpoints.size)} different endpoints: ${[...endpoints].join(', ')}`,
    });
  }

  for (const endpoint of endpoints) {
    if (!endpoint.startsWith('https://')) {
      failures.push({
        check: 'production endpoint',
        detail: `${endpoint} is not HTTPS`,
      });
    }
    if (!endpoint.endsWith('/exec')) {
      failures.push({
        check: 'production endpoint',
        detail: `${endpoint} does not end in /exec. A /dev URL is the always-latest test URL and requires a Google sign-in the SPA cannot complete.`,
      });
    }
  }

  return failures;
}

/**
 * Refuse a production build that never declared itself one.
 *
 * `VITE_APP_ENV` defaults to `development` in the env schema, so a host that
 * forgot to set it produces a build that looks fine and silently runs in
 * development mode.
 */
export function checkAppEnv(
  artefacts: readonly Artefact[],
  env: Record<string, string | undefined>,
): Failure[] {
  const declared = env['VITE_APP_ENV'];
  if (declared === undefined) return [];

  if (declared !== 'production' && declared !== 'development') {
    return [
      {
        check: 'app environment',
        detail: `VITE_APP_ENV is "${declared}"; it must be "production" or "development"`,
      },
    ];
  }

  if (declared !== 'production') return [];

  const carriesDevelopmentMode = artefacts.some(
    (file) => file.text !== null && /"?VITE_APP_ENV"?\s*:\s*"development"/.test(file.text),
  );

  return carriesDevelopmentMode
    ? [
        {
          check: 'app environment',
          detail: 'the build declares production but carries VITE_APP_ENV=development',
        },
      ]
    : [];
}

export function verifyBuild(
  directory: string,
  env: Record<string, string | undefined> = process.env,
): { failures: Failure[]; report: SizeReport } {
  const artefacts = walk(directory);
  const report = sizeReport(artefacts);

  return {
    failures: [
      ...checkArtefacts(artefacts),
      ...checkLazyLoading(report),
      ...checkAppEnv(artefacts, env),
      ...checkProductionEnvironment(artefacts, env),
    ],
    report,
  };
}

function main(): void {
  const directory = process.argv[2] ?? join(process.cwd(), 'dist');

  if (!existsSync(directory)) {
    console.error(`verify-build: ${directory} does not exist. Run \`npm run build\` first.`);
    process.exit(1);
  }

  const { failures, report } = verifyBuild(directory);

  console.log(`\nBuild: ${basename(directory)}`);
  console.log(`  total          ${kilobytes(report.totalBytes)}`);
  console.log(`  javascript     ${kilobytes(report.javascriptBytes)}`);
  console.log(`  entry bundle   ${kilobytes(report.entryBytes)}`);
  for (const chunk of report.lazyChunks) {
    console.log(`  lazy           ${kilobytes(chunk.bytes)}  ${chunk.name}`);
  }

  if (failures.length === 0) {
    console.log(
      '\nverify-build: OK — nothing secret, nothing from development, nothing unhashed.\n',
    );
    return;
  }

  console.error(`\nverify-build: ${String(failures.length)} problem(s) — DO NOT DEPLOY\n`);
  for (const failure of failures) {
    console.error(`  [${failure.check}] ${failure.detail}`);
  }
  console.error('');
  process.exit(1);
}

// Run only when invoked directly, so the checks can be imported by a test.
if (process.argv[1] !== undefined && basename(process.argv[1]) === 'verify-build.ts') {
  main();
}
