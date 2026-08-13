import { describe, expect, it } from 'vitest';

import { bytesToBase64 } from './base64';

describe('bytesToBase64', () => {
  it('matches the platform encoder for small input', () => {
    // `%PDF-`
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect(bytesToBase64(bytes)).toBe('JVBERi0=');
  });

  it('handles every byte value, including the high half', () => {
    // `String.fromCharCode` on a byte over 0x7f is where a naive TextDecoder
    // round trip corrupts the payload.
    const bytes = new Uint8Array(256);
    for (let index = 0; index < 256; index++) bytes[index] = index;

    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('encodes a document-sized payload without blowing the call stack', () => {
    /*
     * The whole reason this helper exists. `btoa(String.fromCharCode(...bytes))`
     * throws RangeError somewhere around 100 KB, so it would fail on every real
     * quotation and pass on every small fixture.
     */
    const bytes = new Uint8Array(1_500_000);
    for (let index = 0; index < bytes.length; index++) bytes[index] = index % 256;

    const encoded = bytesToBase64(bytes);

    expect(encoded).toBe(Buffer.from(bytes).toString('base64'));
    // Four base64 characters per three bytes, exactly.
    expect(encoded.length).toBe((1_500_000 / 3) * 4);
  });

  it('encodes an empty array', () => {
    expect(bytesToBase64(new Uint8Array())).toBe('');
  });
});
