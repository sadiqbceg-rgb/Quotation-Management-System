/**
 * The secret generator.
 *
 * A weak secret here is not a bug that shows up as a failure — it shows up as
 * forged session tokens months later, or as a rainbow table that works against
 * the password hashes. So the tests below assert the properties that make the
 * output actually random rather than merely random-LOOKING, and one of them
 * asserts the thing the whole script exists to guarantee: that no value it
 * produces is ever written anywhere.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  GENERATED_PROPERTIES,
  SECRET_BYTES,
  generateSecret,
  generateSecrets,
  renderHuman,
} from './generate-secrets';

/** The generator's own source, for the two assertions that are about the code. */
function generatorSource(): string {
  return readFileSync(new URL('./generate-secrets.ts', import.meta.url), 'utf8');
}

describe('one secret', () => {
  it('carries at least 32 bytes of entropy', () => {
    // base64url of 32 bytes is 43 characters, unpadded. Anything shorter is
    // fewer than 256 bits, whatever it looks like.
    const secret = generateSecret();

    expect(Buffer.from(secret, 'base64url')).toHaveLength(SECRET_BYTES);
    expect(SECRET_BYTES).toBeGreaterThanOrEqual(32);
  });

  it('is base64url, so nothing mangles it in transit', () => {
    /*
     * `+` and `/` get URL-encoded, mail-wrapped or shell-escaped by something
     * along the way between here and the Script Properties field; `=` padding
     * gets trimmed by something being helpful. Either produces a secret that is
     * subtly not the one that was generated, and the failure surfaces as
     * "everyone is signed out" a week later.
     */
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(generateSecret()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('refuses to generate a weak one, whatever the caller asks for', () => {
    expect(() => generateSecret(16)).toThrow(/at least 32/);
    expect(() => generateSecret(0)).toThrow();
    expect(() => generateSecret(-1)).toThrow();
    expect(() => generateSecret(31.5)).toThrow();
  });

  it('accepts a longer one', () => {
    expect(Buffer.from(generateSecret(64), 'base64url')).toHaveLength(64);
  });

  it('never repeats', () => {
    // The one failure mode invisible to every other assertion here: a
    // generator seeded once and reused, which produces a perfectly well-formed
    // secret that happens to be the same on every deployment.
    const seen = new Set<string>();
    for (let attempt = 0; attempt < 500; attempt += 1) seen.add(generateSecret());

    expect(seen.size).toBe(500);
  });

  it('has no fixed structure — every byte position varies', () => {
    /*
     * A weak generator often varies only part of its output (a counter, a
     * timestamp prefix). Sampling each byte position across many draws catches
     * that: a position constant over 200 samples is not random.
     */
    const samples = Array.from({ length: 200 }, () => Buffer.from(generateSecret(), 'base64url'));

    for (let position = 0; position < SECRET_BYTES; position += 1) {
      const distinct = new Set(samples.map((sample) => sample[position]));
      expect(distinct.size, `byte ${String(position)} barely varies`).toBeGreaterThan(50);
    }
  });
});

describe('the pair', () => {
  it('generates exactly the two Script Properties that are secret', () => {
    expect(Object.keys(generateSecrets()).sort()).toEqual([...GENERATED_PROPERTIES].sort());
  });

  it('makes the two different from each other', () => {
    // Reusing one value for both would mean a leaked session key is also the
    // password pepper — one compromise instead of two.
    const secrets = generateSecrets();
    expect(secrets.SESSION_HMAC_SECRET).not.toBe(secrets.PASSWORD_PEPPER);
  });
});

describe('what the operator is shown', () => {
  it('prints both values, or the setup cannot be completed', () => {
    const secrets = generateSecrets();
    const rendered = renderHuman(secrets);

    for (const name of GENERATED_PROPERTIES) {
      expect(rendered).toContain(name);
      expect(rendered).toContain(secrets[name]);
    }
  });

  it('warns that changing PASSWORD_PEPPER invalidates every password', () => {
    // The most expensive mistake available at this step, and the one an
    // operator "tidying up" the properties later would otherwise make blind.
    expect(renderHuman(generateSecrets())).toMatch(/invalidates EVERY existing password/i);
  });

  it('tells the operator not to commit them', () => {
    expect(renderHuman(generateSecrets())).toMatch(/do NOT commit/i);
  });
});

describe('what it must never do', () => {
  it('writes no file — there is no filesystem write in the module at all', () => {
    /*
     * The point of the script is that a secret exists in exactly two places:
     * the terminal it was printed to, and the Script Properties field it was
     * pasted into. A convenience `--out` added later would quietly break that,
     * so the SOURCE is asserted rather than the behaviour of today's code path.
     */
    expect(generatorSource()).not.toMatch(
      /writeFileSync|appendFileSync|createWriteStream|writeFile\(|appendFile\(/,
    );
  });

  it('uses the crypto RNG, not Math.random', () => {
    const source = generatorSource();

    expect(source).toContain('randomBytes');
    expect(source).not.toContain('Math.random');
  });
});
