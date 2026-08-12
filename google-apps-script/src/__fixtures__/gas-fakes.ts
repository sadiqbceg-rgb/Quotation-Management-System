/**
 * TEST ONLY — in-memory fakes for the Google Apps Script host APIs.
 *
 * Imported only from `*.test.ts`. Never reachable from deployed code: esbuild
 * bundles from `src/main.ts`, so nothing here enters `dist-gas/Code.js`, and the
 * build fails loudly if it ever did (`node:crypto` cannot resolve under
 * `platform: 'neutral'`).
 *
 * The crypto fakes use Node's real HMAC and SHA-256 rather than stubs, so the
 * tests exercise genuine cryptographic behaviour. They faithfully reproduce one
 * Apps Script quirk that trips people up: byte arrays are SIGNED (-128..127).
 */

import { createHash, createHmac, randomUUID } from 'node:crypto';

/* -------------------------------------------------------------------------- */
/* Byte conversion                                                            */
/* -------------------------------------------------------------------------- */

function toSigned(buffer: Buffer): number[] {
  const out: number[] = [];
  for (const byte of buffer) {
    out.push(byte > 127 ? byte - 256 : byte);
  }
  return out;
}

function toBuffer(value: number[] | string): Buffer {
  if (typeof value === 'string') {
    return Buffer.from(value, 'utf8');
  }
  return Buffer.from(value.map((byte) => (byte < 0 ? byte + 256 : byte)));
}

/* -------------------------------------------------------------------------- */
/* Utilities                                                                  */
/* -------------------------------------------------------------------------- */

export function createUtilitiesFake() {
  return {
    DigestAlgorithm: { SHA_256: 'SHA_256' },

    computeHmacSha256Signature(value: number[] | string, key: number[] | string): number[] {
      return toSigned(createHmac('sha256', toBuffer(key)).update(toBuffer(value)).digest());
    },

    computeDigest(_algorithm: string, value: number[] | string): number[] {
      return toSigned(createHash('sha256').update(toBuffer(value)).digest());
    },

    base64Encode(value: number[] | string): string {
      return toBuffer(value).toString('base64');
    },

    base64Decode(value: string): number[] {
      return toSigned(Buffer.from(value, 'base64'));
    },

    base64EncodeWebSafe(value: number[] | string): string {
      return toBuffer(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    },

    base64DecodeWebSafe(value: string): number[] {
      return toSigned(Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
    },

    newBlob(text: string) {
      return {
        getBytes: (): number[] => toSigned(Buffer.from(text, 'utf8')),
        getDataAsString: (): string => text,
      };
    },

    getUuid(): string {
      return randomUUID();
    },
  };
}

/** `newBlob(bytes).getDataAsString()` — used when decoding a token body. */
export function createUtilitiesFakeWithBlobDecode() {
  const base = createUtilitiesFake();
  return {
    ...base,
    newBlob(value: string | number[]) {
      const buffer = toBuffer(value);
      return {
        getBytes: (): number[] => toSigned(buffer),
        getDataAsString: (): string => buffer.toString('utf8'),
      };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* PropertiesService                                                          */
/* -------------------------------------------------------------------------- */

export interface PropertiesFake {
  service: { getScriptProperties: () => unknown };
  values: Map<string, string>;
}

export function createPropertiesFake(initial: Record<string, string> = {}): PropertiesFake {
  const values = new Map<string, string>(Object.entries(initial));

  const properties = {
    getProperty: (key: string): string | null => values.get(key) ?? null,
    setProperty: (key: string, value: string): void => {
      values.set(key, value);
    },
    deleteProperty: (key: string): void => {
      values.delete(key);
    },
    getProperties: (): Record<string, string> => Object.fromEntries(values),
  };

  return { service: { getScriptProperties: () => properties }, values };
}

/* -------------------------------------------------------------------------- */
/* CacheService                                                               */
/* -------------------------------------------------------------------------- */

export interface CacheFake {
  service: { getScriptCache: () => unknown };
  /** Advance the fake clock so entries can expire in tests. */
  advance: (seconds: number) => void;
  entries: Map<string, { value: string; expiresAt: number }>;
}

export function createCacheFake(startSeconds = 0): CacheFake {
  const entries = new Map<string, { value: string; expiresAt: number }>();
  let clock = startSeconds;

  const cache = {
    get: (key: string): string | null => {
      const entry = entries.get(key);
      if (entry === undefined) return null;
      if (entry.expiresAt <= clock) {
        entries.delete(key);
        return null;
      }
      return entry.value;
    },
    put: (key: string, value: string, ttlSeconds: number): void => {
      entries.set(key, { value, expiresAt: clock + ttlSeconds });
    },
    remove: (key: string): void => {
      entries.delete(key);
    },
  };

  return {
    service: { getScriptCache: () => cache },
    advance: (seconds: number) => {
      clock += seconds;
    },
    entries,
  };
}

/* -------------------------------------------------------------------------- */
/* SpreadsheetApp                                                             */
/* -------------------------------------------------------------------------- */

export interface SheetFake {
  name: string;
  rows: unknown[][];
}

export interface SpreadsheetFake {
  service: { openById: (id: string) => unknown };
  sheets: Map<string, SheetFake>;
  /** Rows of a sheet excluding the header, for assertions. */
  dataRows: (name: string) => unknown[][];
}

export function createSpreadsheetFake(): SpreadsheetFake {
  const sheets = new Map<string, SheetFake>();

  function buildSheet(sheet: SheetFake): unknown {
    return {
      getLastRow: (): number => sheet.rows.length,
      getLastColumn: (): number =>
        sheet.rows.reduce((widest, row) => Math.max(widest, row.length), 0),
      setFrozenRows: (): void => undefined,
      appendRow: (values: unknown[]): void => {
        sheet.rows.push(values.slice());
      },
      getRange: (row: number, column: number, numRows = 1, numColumns = 1) => ({
        getValues: (): unknown[][] => {
          const out: unknown[][] = [];
          for (let r = 0; r < numRows; r++) {
            const source = sheet.rows[row - 1 + r] ?? [];
            const slice: unknown[] = [];
            for (let c = 0; c < numColumns; c++) {
              slice.push(source[column - 1 + c] ?? '');
            }
            out.push(slice);
          }
          return out;
        },
        setValues: (values: unknown[][]): void => {
          values.forEach((rowValues, r) => {
            const target = sheet.rows[row - 1 + r] ?? [];
            rowValues.forEach((value, c) => {
              target[column - 1 + c] = value;
            });
            sheet.rows[row - 1 + r] = target;
          });
        },
        setValue: (value: unknown): void => {
          const target = sheet.rows[row - 1] ?? [];
          target[column - 1] = value;
          sheet.rows[row - 1] = target;
        },
      }),
    };
  }

  const spreadsheet = {
    getSheetByName: (name: string): unknown =>
      sheets.has(name) ? buildSheet(sheets.get(name)!) : null,
    insertSheet: (name: string): unknown => {
      const sheet: SheetFake = { name, rows: [] };
      sheets.set(name, sheet);
      return buildSheet(sheet);
    },
  };

  return {
    service: { openById: () => spreadsheet },
    sheets,
    dataRows: (name: string) => (sheets.get(name)?.rows ?? []).slice(1),
  };
}

/* -------------------------------------------------------------------------- */
/* ContentService                                                             */
/* -------------------------------------------------------------------------- */

export interface TextOutputFake {
  getContent: () => string;
  getMimeType: () => string;
  setMimeType: (mimeType: string) => TextOutputFake;
}

export function createContentServiceFake() {
  return {
    MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
    createTextOutput(content: string): TextOutputFake {
      let mimeType = 'text/plain';
      const output: TextOutputFake = {
        getContent: () => content,
        getMimeType: () => mimeType,
        setMimeType: (value: string) => {
          mimeType = value;
          return output;
        },
      };
      return output;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Installation                                                               */
/* -------------------------------------------------------------------------- */

export interface GasEnvironment {
  properties: PropertiesFake;
  cache: CacheFake;
  spreadsheet: SpreadsheetFake;
}

/**
 * Install a complete fake Apps Script host on `globalThis`.
 *
 * `stub` is Vitest's `vi.stubGlobal`, passed in so this module stays free of a
 * test-framework import.
 */
export function installGasFakes(
  stub: (name: string, value: unknown) => void,
  properties: Record<string, string> = {},
): GasEnvironment {
  const propertiesFake = createPropertiesFake({
    SESSION_HMAC_SECRET: 'test-only-session-secret-not-a-real-key',
    PASSWORD_PEPPER: 'test-only-pepper-not-a-real-key',
    DRIVE_ROOT_FOLDER_ID: 'test-only-drive-root',
    TRACKING_SPREADSHEET_ID: 'test-only-spreadsheet',
    ...properties,
  });
  const cacheFake = createCacheFake();
  const spreadsheetFake = createSpreadsheetFake();

  stub('Utilities', createUtilitiesFakeWithBlobDecode());
  stub('PropertiesService', propertiesFake.service);
  stub('CacheService', cacheFake.service);
  stub('SpreadsheetApp', spreadsheetFake.service);
  stub('ContentService', createContentServiceFake());
  stub('console', { ...console, error: () => undefined, log: () => undefined });

  return { properties: propertiesFake, cache: cacheFake, spreadsheet: spreadsheetFake };
}
