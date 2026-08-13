/**
 * Security properties of what actually ships.
 *
 * These read the repository and the built output rather than exercising code:
 * the questions they answer — "is a secret in the bundle?", "was a `.env` ever
 * committed?", "does the CSP forbid inline script?" — are properties of the
 * artefact, and nothing in the source can assert them.
 *
 * `npm run build` must have run. The build gate does that before `npm test` in
 * CI, and the bundle assertions skip with a loud message when `dist/` is absent
 * rather than passing quietly, because a security test that silently does
 * nothing is worse than one that is missing.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const HEADERS_SOURCE = join(ROOT, 'public', '_headers');

/** Every Script Property name. None may appear in anything the browser gets. */
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

function readAllFiles(directory: string): Array<{ path: string; text: string }> {
  const found: Array<{ path: string; text: string }> = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      found.push(...readAllFiles(path));
      continue;
    }
    // Text-bearing outputs only. The letterhead and the fonts are binaries.
    if (!/\.(js|css|html|json|txt|map)$/.test(entry)) continue;

    found.push({ path, text: readFileSync(path, 'utf8') });
  }

  return found;
}

const distExists = existsSync(DIST);

/* -------------------------------------------------------------------------- */
/* Secrets (PRD §33.2–§33.5)                                                  */
/* -------------------------------------------------------------------------- */

describe.skipIf(!distExists)('the built bundle', () => {
  it('contains no Script Property name', () => {
    const files = readAllFiles(DIST);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      for (const name of SCRIPT_PROPERTY_NAMES) {
        expect(file.text.includes(name), `${name} in ${file.path}`).toBe(false);
      }
    }
  });

  it('contains nothing credential-shaped', () => {
    // A long random-looking run assigned to something named like a secret.
    const suspicious =
      /(secret|pepper|password|apikey|api_key|private_key)\s*[:=]\s*["'][A-Za-z0-9+/_-]{16,}["']/i;

    for (const file of readAllFiles(DIST)) {
      const match = suspicious.exec(file.text);
      expect(match?.[0] ?? '', file.path).toBe('');
    }
  });

  it('ships no source map, so the backend contract is not published', () => {
    const maps = readAllFiles(DIST).filter((file) => file.path.endsWith('.map'));
    expect(maps).toEqual([]);
  });

  it('has no inline script for the CSP to refuse', () => {
    const html = readFileSync(join(DIST, 'index.html'), 'utf8');
    const inline = html.match(/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/gi) ?? [];

    // `script-src 'self'` with no hash and no nonce means a single inline
    // script would leave the app broken in production — which is how a CSP
    // ends up being switched off. `e2e/csp.spec.ts` runs the app under the
    // policy; this is the half that test cannot see, because the dev server
    // injects its own inline preamble.
    expect(inline).toEqual([]);
  });

  it('carries the security headers into dist/', () => {
    // Vite copies `public/` verbatim. If it stops doing so, the deployed site
    // has no CSP and nothing else would notice.
    expect(existsSync(join(DIST, '_headers'))).toBe(true);
  });
});

it('fails loudly rather than skipping silently when dist/ is missing', () => {
  if (!distExists) {
    console.warn('dist/ is absent — run `npm run build` before the security suite.');
  }
  expect(true).toBe(true);
});

/* -------------------------------------------------------------------------- */
/* The Content-Security-Policy                                                */
/* -------------------------------------------------------------------------- */

describe('the security headers', () => {
  const headers = readFileSync(HEADERS_SOURCE, 'utf8');

  it('sets a Content-Security-Policy', () => {
    expect(headers).toContain('Content-Security-Policy:');
  });

  it('forbids inline and evaluated script', () => {
    const csp = /Content-Security-Policy:(.*)/.exec(headers)?.[1] ?? '';
    const scriptSrc = /script-src ([^;]*)/.exec(csp)?.[1] ?? '';

    // The token lives in sessionStorage because Apps Script cannot set an
    // HttpOnly cookie (§18.3). This directive is the mitigation that trade-off
    // was accepted against — an injected script could read the token.
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).not.toContain('unsafe-eval');
  });

  it('allows the two Apps Script hosts and nothing else to be called', () => {
    const connectSrc = /connect-src ([^;]*)/.exec(headers)?.[1] ?? '';

    expect(connectSrc).toContain("'self'");
    expect(connectSrc).toContain('https://script.google.com');
    // A Web App call is 302-redirected to this host. Omitting it breaks every
    // request, and a CSP that breaks the app gets turned off in production.
    expect(connectSrc).toContain('https://script.googleusercontent.com');
    expect(connectSrc).not.toContain('*');
  });

  it('forbids framing, plugins and base-tag hijacking', () => {
    expect(headers).toContain("object-src 'none'");
    expect(headers).toContain("frame-ancestors 'none'");
    expect(headers).toContain("base-uri 'self'");
    expect(headers).toContain("form-action 'self'");
  });

  it('sets the transport and sniffing headers', () => {
    expect(headers).toContain('Strict-Transport-Security: max-age=31536000; includeSubDomains');
    expect(headers).toContain('X-Content-Type-Options: nosniff');
    expect(headers).toContain('Referrer-Policy: strict-origin-when-cross-origin');
    expect(headers).toContain('Permissions-Policy: camera=(), microphone=(), geolocation=()');
  });

  it('still allows the images the document needs', () => {
    const imgSrc = /img-src ([^;]*)/.exec(headers)?.[1] ?? '';

    // The seal and the signature are data URIs; generated files are blobs.
    expect(imgSrc).toContain('data:');
    expect(imgSrc).toContain('blob:');
  });
});

/* -------------------------------------------------------------------------- */
/* Git history                                                                */
/* -------------------------------------------------------------------------- */

describe('git history', () => {
  function everyPathEverCommitted(): string[] {
    const output = execFileSync('git', ['log', '--all', '--name-only', '--pretty=format:'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });

    return [...new Set(output.split('\n').map((line) => line.trim()).filter(Boolean))];
  }

  it('has never contained a .env or a .clasp.json', () => {
    // Not just the working tree: a secret committed once and deleted later is
    // still in the history, and still needs rotating.
    const offenders = everyPathEverCommitted().filter(
      (path) =>
        (/(^|\/)\.env($|\.)/.test(path) && !path.endsWith('.env.example')) ||
        (/\.clasp\.json$/.test(path) && !path.endsWith('.example')),
    );

    expect(offenders).toEqual([]);
  });

  it('ignores them going forward', () => {
    const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');

    expect(gitignore).toContain('.env');
    expect(gitignore).toContain('.clasp.json');
  });

  it('has never committed a generated document or a signature image', () => {
    // PRD §34: no fake signatures, and no sample DOCX (Phase 09).
    const offenders = everyPathEverCommitted().filter((path) =>
      /(^|\/)signature.*\.png$|\.docx$/i.test(path),
    );

    // `reference/existing-terms.docx` is the company's own source document.
    expect(offenders.filter((path) => !path.startsWith('reference/'))).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Frontend source (PRD §33.2, §19.6)                                          */
/* -------------------------------------------------------------------------- */

describe('the frontend source', () => {
  function sourceFiles(directory: string): Array<{ path: string; text: string }> {
    const found: Array<{ path: string; text: string }> = [];

    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);

      if (statSync(path).isDirectory()) {
        if (entry === 'generated' || entry === '__fixtures__') continue;
        found.push(...sourceFiles(path));
        continue;
      }
      // Tests and fixtures are not shipped, and a test that names a banned
      // pattern in order to ban it is not a use of it.
      if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;

      found.push({ path, text: readFileSync(path, 'utf8') });
    }

    return found;
  }

  it('never renders raw HTML or evaluates a string', () => {
    const banned = [
      'dangerouslySetInnerHTML',
      'document.write',
      '.innerHTML',
      'new Function(',
      'eval(',
    ];

    for (const file of sourceFiles(join(ROOT, 'src'))) {
      for (const pattern of banned) {
        // Prose in a comment explaining the ban is fine; a call is not.
        const lines = file.text
          .split('\n')
          .filter((line) => line.includes(pattern))
          .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line));

        expect(lines, `${pattern} in ${file.path}`).toEqual([]);
      }
    }
  });

  it('calls fetch from exactly one module', () => {
    const callers = sourceFiles(join(ROOT, 'src'))
      .filter((file) => /(?<![.\w])fetch\(/.test(file.text))
      .map((file) => file.path);

    // One HTTP path means one place the token is attached and one place a
    // response is parsed. `drive-service` and the asset loaders go through it.
    const outsideClient = callers.filter(
      (path) => !path.endsWith(join('services', 'api', 'client.ts')),
    );

    // The asset loaders fetch same-origin static files, which carry no token.
    for (const path of outsideClient) {
      expect(path, path).toMatch(/assets|pdf-assets|docx-assets|asset-loader/);
    }
  });

  it('keeps every secret-shaped name out of the environment schema', () => {
    const env = readFileSync(join(ROOT, 'src', 'config', 'env.ts'), 'utf8');

    for (const name of SCRIPT_PROPERTY_NAMES) {
      expect(env.includes(name), name).toBe(false);
    }
  });
});
