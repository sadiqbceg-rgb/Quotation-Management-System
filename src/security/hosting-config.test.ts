/**
 * The hosting configuration cannot drift (W-3).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TEST EXISTS
 * ---------------------------------------------------------------------------
 * The security header policy lives in `public/_headers`, which Vite copies
 * verbatim into `dist/` and which Netlify and Cloudflare Pages both read.
 * Vercel reads none of it — it reads `vercel.json`, which restates every
 * header. `public/_headers` says so at the top and warns that a value changed
 * in one and not the other means a Vercel deployment quietly runs a weaker
 * policy than the one that was reviewed.
 *
 * That warning was a comment nothing enforced. This is the enforcement.
 *
 * The policy is NOT duplicated here: `public/_headers` stays the single source
 * and every expectation below is derived from it. A test that restated the CSP
 * would be a third copy to keep in step.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const HEADERS_SOURCE = readFileSync(join(ROOT, 'public', '_headers'), 'utf8');
const VERCEL = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as VercelConfig;

interface VercelConfig {
  buildCommand?: string;
  outputDirectory?: string;
  rewrites?: Array<{ source: string; destination: string }>;
  headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
}

/**
 * The headers `public/_headers` applies to a path.
 *
 * The format is a path line followed by indented `Key: value` lines, so a
 * section runs until the next unindented line.
 */
function headersFor(pathPattern: string): Map<string, string> {
  const found = new Map<string, string>();
  let inSection = false;

  for (const line of HEADERS_SOURCE.split('\n')) {
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) continue;

    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      inSection = line.trim() === pathPattern;
      continue;
    }
    if (!inSection) continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;
    found.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }

  return found;
}

function vercelHeadersFor(source: string): Map<string, string> {
  const rule = (VERCEL.headers ?? []).find((entry) => entry.source === source);
  return new Map((rule?.headers ?? []).map((header) => [header.key, header.value]));
}

const CANONICAL = headersFor('/*');
const CANONICAL_ASSETS = headersFor('/assets/*');
const VERCEL_ALL = vercelHeadersFor('/(.*)');
const VERCEL_ASSETS = vercelHeadersFor('/assets/(.*)');

/* -------------------------------------------------------------------------- */

describe('the source of truth is readable', () => {
  it('parses the seven headers out of public/_headers', () => {
    // If this fails the parser is wrong and every expectation below is vacuous.
    expect([...CANONICAL.keys()].sort()).toEqual([
      'Cache-Control',
      'Content-Security-Policy',
      'Permissions-Policy',
      'Referrer-Policy',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'X-Frame-Options',
    ]);
  });

  it('finds the immutable asset rule', () => {
    expect(CANONICAL_ASSETS.get('Cache-Control')).toContain('immutable');
  });
});

describe('vercel.json carries the same policy', () => {
  it.each([...CANONICAL.entries()])('restates %s exactly', (key, value) => {
    // Byte-for-byte. A CSP that differs by one directive is a different policy.
    expect(VERCEL_ALL.get(key)).toBe(value);
  });

  it('adds no header the reviewed policy does not have', () => {
    expect([...VERCEL_ALL.keys()].sort()).toEqual([...CANONICAL.keys()].sort());
  });

  it('restates the immutable asset caching', () => {
    expect(VERCEL_ASSETS.get('Cache-Control')).toBe(CANONICAL_ASSETS.get('Cache-Control'));
  });
});

describe('the protections that must never be lost', () => {
  const csp = VERCEL_ALL.get('Content-Security-Policy') ?? '';

  it('forbids inline and evaluated script', () => {
    // The token lives in sessionStorage, so XSS is the highest-value attack
    // here and `script-src 'self'` is the mitigation that was accepted against
    // that trade-off.
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it('allows the two Apps Script hosts and nothing else to be called', () => {
    expect(csp).toContain('connect-src');
    expect(csp).toContain('https://script.google.com');
    // A Web App call is 302-redirected to the second host; omitting it breaks
    // every request.
    expect(csp).toContain('https://script.googleusercontent.com');
  });

  it('forbids framing and base-tag hijacking', () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(VERCEL_ALL.get('X-Frame-Options')).toBe('DENY');
  });

  it('sets the transport and sniffing headers', () => {
    expect(VERCEL_ALL.get('Strict-Transport-Security')).toContain('max-age=');
    expect(VERCEL_ALL.get('X-Content-Type-Options')).toBe('nosniff');
    expect(VERCEL_ALL.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(VERCEL_ALL.get('Permissions-Policy')).toContain('camera=()');
  });

  it('never caches the entry point, so a stale index.html cannot strand a user', () => {
    expect(VERCEL_ALL.get('Cache-Control')).toContain('max-age=0');
    expect(VERCEL_ALL.get('Cache-Control')).toContain('must-revalidate');
  });
});

describe('SPA routing', () => {
  it('rewrites unmatched paths to index.html', () => {
    const rewrite = (VERCEL.rewrites ?? [])[0];

    expect(rewrite?.destination).toBe('/index.html');
  });

  it('does not swallow the hashed assets', () => {
    // A rewrite that caught /assets/ would serve HTML where the browser expects
    // JavaScript, and the whole app would fail to boot.
    const rewrite = (VERCEL.rewrites ?? [])[0];

    expect(rewrite?.source).toContain('assets/');

    // Anchored, because Vercel matches the whole path. An unanchored test would
    // find the pattern later in the string and report a pass that means nothing.
    const pattern = new RegExp(`^${rewrite?.source ?? ''}$`);
    expect(pattern.test('/assets/index-abc123.js')).toBe(false);
    expect(pattern.test('/quotations/new')).toBe(true);
  });

  it('builds and publishes the same directory the other hosts do', () => {
    expect(VERCEL.buildCommand).toBe('npm run build');
    expect(VERCEL.outputDirectory).toBe('dist');
  });
});
