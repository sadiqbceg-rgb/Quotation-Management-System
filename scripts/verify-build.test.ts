/**
 * The pre-deploy build gate.
 *
 * ---------------------------------------------------------------------------
 * A GATE NOBODY HAS SEEN FAIL IS NOT A GATE
 * ---------------------------------------------------------------------------
 * `verify-build` passes today, and would pass just as quietly if a check had
 * been written wrongly and matched nothing. So every check below is exercised
 * twice: once against an artefact that must pass, and once against one that
 * must fail. The failing cases are the real tests — they are the mistakes the
 * script exists to catch, reproduced on disk.
 *
 * Everything runs against a temporary directory. No real `dist/` is read and
 * nothing here can be deployed.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { testOutputDir } from '../test/helpers/temp-output';
import {
  checkAppEnv,
  checkArtefacts,
  checkLazyLoading,
  checkProductionEnvironment,
  endpointFailures,
  sizeReport,
  type Failure,
  verifyBuild,
} from './verify-build';

/* -------------------------------------------------------------------------- */
/* A build on disk                                                            */
/* -------------------------------------------------------------------------- */

const PRODUCTION_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxSpeedFalconProd/exec';

/** A build with nothing wrong with it, for each test to then break one way. */
function goodBuild(): Record<string, string> {
  return {
    'index.html':
      '<!doctype html><html><head><title>Speed Falcon</title>' +
      '<script type="module" crossorigin src="/assets/index-A1b2C3d4.js"></script>' +
      '</head><body><div id="root"></div></body></html>',
    _headers: "/*\n  Content-Security-Policy: default-src 'self'\n",
    'assets/index-A1b2C3d4.js': `const e="${PRODUCTION_ENDPOINT}";export{e};`,
    'assets/index-Z9y8X7w6.css': '.a{color:#000}',
    'assets/pdf-generator-Q1w2E3r4.js': 'export const pdf=1;',
    'assets/docx-generator-T5y6U7i8.js': 'export const docx=1;',
  };
}

/**
 * Every directory created, so afterEach removes all of them.
 *
 * A test may build more than once — `checksFired` and `failuresFor` each build
 * — and tracking only the latest leaves the earlier ones on disk to be found by
 * the next thing that walks the tree.
 */
const created: string[] = [];
let sequence = 0;

/** Write a build into a fresh temporary directory and return its path. */
function build(files: Record<string, string>): string {
  sequence += 1;
  const directory = testOutputDir(`verify-build-${String(sequence)}`);
  created.push(directory);

  for (const [name, contents] of Object.entries(files)) {
    const path = join(directory, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, contents, 'utf8');
  }

  return directory;
}

/** Run the gate over a build and return its failures. */
function failuresFor(files: Record<string, string>): Failure[] {
  return verifyBuild(build(files)).failures;
}

/** The `check` labels that fired, which is what each test is really asserting. */
function checksFired(files: Record<string, string>): string[] {
  return [...new Set(failuresFor(files).map((failure) => failure.check))];
}

afterEach(() => {
  for (const directory of created.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/* -------------------------------------------------------------------------- */
/* The control                                                                */
/* -------------------------------------------------------------------------- */

describe('a build that should ship', () => {
  it('passes every check', () => {
    // If this ever fails, the failures below prove nothing: a gate that
    // rejects everything is as useless as one that rejects nothing.
    expect(failuresFor(goodBuild())).toEqual([]);
  });

  it('reports the sizes, which is the other half of what it is for', () => {
    const { report } = verifyBuild(build(goodBuild()));

    expect(report.totalBytes).toBeGreaterThan(0);
    expect(report.javascriptBytes).toBeGreaterThan(0);
    expect(report.entryBytes).toBeGreaterThan(0);
    expect(report.lazyChunks.map((chunk) => chunk.name).sort()).toEqual([
      'docx-generator-T5y6U7i8.js',
      'pdf-generator-Q1w2E3r4.js',
    ]);
  });

  it('counts only the entry as the entry, not every JavaScript file', () => {
    // The number an operator reads to decide whether the app got heavier is
    // the first-load cost. Summing the lazy chunks into it hides the entire
    // point of splitting them out.
    const { report } = verifyBuild(build(goodBuild()));

    expect(report.entryBytes).toBeLessThan(report.javascriptBytes);
  });
});

/* -------------------------------------------------------------------------- */
/* Secrets                                                                    */
/* -------------------------------------------------------------------------- */

describe('a backend secret in the bundle', () => {
  it('fails on a Script Property NAME, before any value has leaked', () => {
    /*
     * The name in the frontend means frontend code is reaching for a backend
     * secret. Nothing has leaked yet — that is the point of catching it here
     * rather than after somebody wires the value up to match.
     */
    const files = goodBuild();
    files['assets/index-A1b2C3d4.js'] += 'const p=import.meta.env.SESSION_HMAC_SECRET;';

    expect(checksFired(files)).toContain('no Script Property name');
  });

  it('fails on every property name, not only the two obvious ones', () => {
    for (const name of [
      'PASSWORD_PEPPER',
      'DRIVE_ROOT_FOLDER_ID',
      'TRACKING_SPREADSHEET_ID',
      'BOOTSTRAP_ADMIN_PASSWORD',
      'REVOKED_TOKEN_IDS',
    ]) {
      const files = goodBuild();
      files['assets/index-A1b2C3d4.js'] += `const x="${name}";`;

      expect(checksFired(files), name).toContain('no Script Property name');
    }
  });

  it('fails on a credential-shaped assignment even under a name it does not know', () => {
    const files = goodBuild();
    files['assets/index-A1b2C3d4.js'] += 'const apiKey="Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5";';

    expect(checksFired(files)).toContain('nothing credential-shaped');
  });

  it('never prints the matched value — that is the thing being protected', () => {
    const files = goodBuild();
    files['assets/index-A1b2C3d4.js'] += 'const secret="hunter2hunter2hunter2hunter2";';

    const failures = failuresFor(files);
    const printed = failures.map((failure) => `${failure.check} ${failure.detail}`).join('\n');

    expect(printed).toContain('credential-shaped');
    expect(printed).not.toContain('hunter2hunter2hunter2hunter2');
  });

  it('does not fire on ordinary code that mentions a password field', () => {
    // A gate that cries wolf is a gate that gets commented out. `password` in
    // a form field name or an error message must not fail a build.
    const files = goodBuild();
    files['assets/index-A1b2C3d4.js'] +=
      'const f={name:"password",label:"Password"};const e="Your password is incorrect.";';

    expect(failuresFor(files)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* The endpoint                                                               */
/* -------------------------------------------------------------------------- */

describe('the backend endpoint baked into the bundle', () => {
  it('accepts a real Apps Script deployment URL', () => {
    expect(endpointFailures('index.js', `fetch("${PRODUCTION_ENDPOINT}")`)).toEqual([]);
  });

  it('rejects a test deployment left in by a stale .env.local', () => {
    /*
     * The actual mistake this catches: `.env.local` still in place when the
     * production build ran. The app then talks to a deployment that is not the
     * company's, and every quotation it issues is issued somewhere else.
     */
    const failures = endpointFailures(
      'index.js',
      'fetch("https://script.google.com/macros/s/TEST_ONLY-e2e-deployment/exec")',
    );

    expect(failures).toHaveLength(1);
    expect(failures[0]?.check).toBe('backend endpoint');
    expect(failures[0]?.detail).toMatch(/non-production/);
  });

  it('rejects a plain-HTTP endpoint', () => {
    // The session token travels in the request body. Over HTTP it travels in
    // the clear, to anyone on the network between the browser and Google.
    const failures = endpointFailures(
      'index.js',
      'fetch("http://script.google.com/macros/s/AKfycbxReal/exec")',
    );

    expect(failures).toHaveLength(1);
    expect(failures[0]?.detail).toMatch(/not an Apps Script HTTPS endpoint/);
  });

  it('rejects an endpoint on a host that is not Google', () => {
    // A proxy or a mock server. The bundle must call Google directly.
    expect(
      endpointFailures('index.js', 'fetch("https://qms.example.com/macros/s/AKfycbx/exec")'),
    ).toHaveLength(1);
  });

  it('reports every bad endpoint, not just the first', () => {
    const failures = endpointFailures(
      'index.js',
      'a("http://localhost:3000/macros/s/dev/exec");b("https://script.google.com/macros/s/TEST_ONLY-x/exec")',
    );

    expect(failures).toHaveLength(2);
  });

  it('does not fire on React Router’s own localhost fallback', () => {
    /*
     * This is why the check validates ENDPOINTS rather than scanning for the
     * string `localhost`. React Router ships `let s = "http://localhost"` as
     * its fallback when `window.location` is unavailable, so a blanket scan
     * fails every build that has ever been produced.
     */
    const files = goodBuild();
    files['assets/index-A1b2C3d4.js'] += 'let s="http://localhost";';

    expect(failuresFor(files)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Development leftovers                                                      */
/* -------------------------------------------------------------------------- */

describe('a development build shipped by accident', () => {
  it('fails on the project’s synthetic-data marker', () => {
    const files = goodBuild();
    files['assets/index-A1b2C3d4.js'] += 'const client={name:"TEST_ONLY Acme Trading"};';

    expect(checksFired(files)).toContain('no development marker');
  });

  it('fails on the Vite dev-server polyfill', () => {
    const files = goodBuild();
    files['assets/index-A1b2C3d4.js'] += 'import"/vite/modulepreload-polyfill.js?t=1";';

    expect(checksFired(files)).toContain('no development marker');
  });

  it('fails on a published source map', () => {
    // A source map hands out the whole frontend, including every action name
    // and payload shape the backend accepts.
    const files = goodBuild();
    files['assets/index-A1b2C3d4.js.map'] = '{"version":3,"sources":["../src/main.tsx"]}';

    expect(checksFired(files)).toContain('no source map');
  });
});

/* -------------------------------------------------------------------------- */
/* The entry point and the headers                                            */
/* -------------------------------------------------------------------------- */

describe('the served page', () => {
  it('fails when index.html is missing', () => {
    const files = goodBuild();
    delete files['index.html'];

    expect(checksFired(files)).toContain('entry point');
  });

  it('fails on an inline script, which the CSP would refuse', () => {
    /*
     * `script-src 'self'` with no hash and no nonce means an inline script
     * simply does not run. The app is then broken in production in a way that
     * works perfectly in `vite dev` — and the usual fix somebody reaches for is
     * to weaken the CSP.
     */
    const files = goodBuild();
    files['index.html'] = files['index.html']!.replace(
      '<body>',
      '<body><script>window.__CONFIG={};</script>',
    );

    expect(checksFired(files)).toContain('no inline script');
  });

  it('does not mistake the module <script src> for an inline one', () => {
    expect(failuresFor(goodBuild())).toEqual([]);
  });

  it('fails when _headers did not make it into the build', () => {
    // Without it the deployed site has no CSP, no frame-ancestors and no
    // referrer policy — and nothing about the site looks wrong.
    const files = goodBuild();
    delete files['_headers'];

    expect(checksFired(files)).toContain('security headers');
  });
});

/* -------------------------------------------------------------------------- */
/* Caching                                                                    */
/* -------------------------------------------------------------------------- */

describe('content hashes', () => {
  it('fails on an asset without one', () => {
    /*
     * The host serves `/assets/*` with a year-long cache. Without a hash in the
     * name, a user keeps last month's bundle until they clear their browser
     * cache — and the report is "the fix did not work for me".
     */
    const files = goodBuild();
    files['assets/legacy.js'] = 'export const legacy=1;';

    expect(checksFired(files)).toContain('hashed asset filenames');
  });

  it('names the offending file, so the fix does not need a search', () => {
    const files = goodBuild();
    files['assets/legacy.js'] = 'export const legacy=1;';

    const failure = failuresFor(files).find((f) => f.check === 'hashed asset filenames');
    expect(failure?.detail).toContain('legacy.js');
  });
});

/* -------------------------------------------------------------------------- */
/* Lazy loading                                                               */
/* -------------------------------------------------------------------------- */

describe('the document generators', () => {
  it('fails when the PDF generator is not its own chunk', () => {
    // pdf-lib plus its fontkit is over a megabyte. In the entry bundle that is
    // paid by every user on every load, including the login screen.
    const files = goodBuild();
    delete files['assets/pdf-generator-Q1w2E3r4.js'];

    expect(checksFired(files)).toContain('lazy document modules');
  });

  it('fails when the DOCX generator is not its own chunk', () => {
    const files = goodBuild();
    delete files['assets/docx-generator-T5y6U7i8.js'];

    const failures = failuresFor(files);
    expect(failures.some((f) => f.detail.includes('docx'))).toBe(true);
  });

  it('reports both when neither was split out', () => {
    expect(
      checkLazyLoading({ totalBytes: 1, javascriptBytes: 1, entryBytes: 1, lazyChunks: [] }),
    ).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Pointed at the wrong thing                                                 */
/* -------------------------------------------------------------------------- */

describe('pointed at a directory that is not a build', () => {
  it('says so rather than passing silently', () => {
    /*
     * The dangerous failure: `verify-build` run against an empty or wrong
     * directory finds nothing wrong, prints OK, and an operator deploys on the
     * strength of it.
     */
    const failures = checkArtefacts([]);

    expect(failures).toHaveLength(1);
    expect(failures[0]?.check).toBe('artefacts present');
    expect(failures[0]?.detail).toMatch(/build directory/);
  });

  it('reports a zero entry size rather than guessing at one', () => {
    expect(sizeReport([]).entryBytes).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Production environment (W-2)                                               */
/* -------------------------------------------------------------------------- */

const PROD_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxTESTONLYdeployment000000/exec';

function artefact(text: string): { path: string; name: string; bytes: number; text: string } {
  return { path: `/dist/${'index.js'}`, name: 'index.js', bytes: text.length, text };
}

describe('the app environment', () => {
  it('is not enforced when the build does not declare production', () => {
    // A developer running deploy:check locally must not be blocked.
    expect(checkAppEnv([artefact('x')], { VITE_APP_ENV: 'development' })).toEqual([]);
    expect(checkAppEnv([artefact('x')], {})).toEqual([]);
  });

  it('refuses a value that is neither production nor development', () => {
    const failures = checkAppEnv([artefact('x')], { VITE_APP_ENV: 'staging' });

    expect(failures).toHaveLength(1);
    expect(failures[0]?.detail).toMatch(/must be "production" or "development"/);
  });

  it('refuses a production build that carries development mode', () => {
    const failures = checkAppEnv([artefact('VITE_APP_ENV:"development"')], {
      VITE_APP_ENV: 'production',
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]?.check).toBe('app environment');
  });

  it('passes a clean production build', () => {
    expect(checkAppEnv([artefact(PROD_ENDPOINT)], { VITE_APP_ENV: 'production' })).toEqual([]);
  });
});

describe('the production endpoint', () => {
  it('is not checked unless the build declares production', () => {
    expect(checkProductionEnvironment([artefact('nothing here')], {})).toEqual([]);
    expect(
      checkProductionEnvironment([artefact('nothing here')], { VITE_APP_ENV: 'development' }),
    ).toEqual([]);
  });

  it('refuses a production build with no endpoint at all', () => {
    const failures = checkProductionEnvironment([artefact('no endpoint')], {
      VITE_APP_ENV: 'production',
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]?.detail).toMatch(/VITE_GAS_ENDPOINT/);
  });

  it('accepts a single HTTPS /exec endpoint', () => {
    expect(
      checkProductionEnvironment([artefact(PROD_ENDPOINT)], { VITE_APP_ENV: 'production' }),
    ).toEqual([]);
  });

  it('refuses a /dev URL, which needs a sign-in the SPA cannot complete', () => {
    const dev = 'https://script.google.com/macros/s/AKfycbxTESTONLYdeployment000000/dev';
    const failures = checkProductionEnvironment([artefact(dev)], { VITE_APP_ENV: 'production' });

    expect(failures.some((failure) => /\/exec/.test(failure.detail))).toBe(true);
  });

  it('refuses two different endpoints in one bundle', () => {
    const second = 'https://script.google.com/macros/s/AKfycbxTESTONLYdifferent00000/exec';
    const failures = checkProductionEnvironment([artefact(`${PROD_ENDPOINT} ${second}`)], {
      VITE_APP_ENV: 'production',
    });

    expect(failures.some((failure) => /different endpoints/.test(failure.detail))).toBe(true);
  });

  it('does NOT pretend to tell development from production', () => {
    /*
     * Both are `https://script.google.com/macros/s/<opaque>/exec` and Google
     * encodes nothing about the environment in the id. A heuristic here would
     * either block a correct deploy or wave through the wrong endpoint while
     * appearing to have checked it, so this deliberately passes both and the
     * comparison stays a documented manual step.
     */
    const looksLikeDev = 'https://script.google.com/macros/s/AKfycbxTESTONLYdevdeploy000000/exec';

    expect(
      checkProductionEnvironment([artefact(looksLikeDev)], { VITE_APP_ENV: 'production' }),
    ).toEqual([]);
  });
});
