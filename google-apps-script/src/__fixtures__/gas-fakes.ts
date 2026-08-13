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

/**
 * `newBlob(bytes).getDataAsString()` — used when decoding a token body, and
 * `newBlob(bytes, mimeType, name)` when writing a signature to Drive.
 */
export function createUtilitiesFakeWithBlobDecode() {
  const base = createUtilitiesFake();
  return {
    ...base,
    newBlob(value: string | number[], mimeType?: string, name?: string) {
      const buffer = toBuffer(value);
      return {
        getBytes: (): number[] => toSigned(buffer),
        getDataAsString: (): string => buffer.toString('utf8'),
        getName: (): string => name ?? '',
        getContentType: (): string => mimeType ?? '',
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
  get: (key: string) => string | undefined;
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

  return {
    service: { getScriptProperties: () => properties },
    values,
    get: (key: string) => values.get(key),
  };
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
  /** Number formats applied, as `column:format`. */
  numberFormats: string[];
  /** The allowed values of the data validation on a column, by column number. */
  validations: Map<number, string[]>;
  /** Conditional format rules, as their formulas. */
  conditionalRules: string[];
  frozenRows: number;
  /** True once `hideSheet()` has been called — `Users` and `AuditLog`. */
  hidden: boolean;
}

export interface SpreadsheetFake {
  service: { openById: (id: string) => unknown };
  sheets: Map<string, SheetFake>;
  /** Rows of a sheet excluding the header, for assertions. */
  dataRows: (name: string) => unknown[][];
  /** A sheet's recorded formatting, for assertions. */
  formatting: (name: string) => SheetFake | undefined;
  /** Round trips to `getRange`, for asserting the per-save cost stays constant. */
  rangeCalls: () => number;
  /**
   * Fire a callback immediately before a sheet's values are read.
   *
   * This is the seam the concurrency harness suspends a request at: a reader
   * that is mid-critical-section can be interrupted here and another request
   * started from inside it, which is what makes an interleaving test genuine
   * rather than a sequential loop (Phase 13, Architecture Requirements).
   *
   * Pass `null` to remove it. Reads performed BY the listener do not re-enter
   * it, so a listener may itself use the spreadsheet without looping forever.
   */
  onRead: (listener: ((sheetName: string) => void) | null) => void;
}

export function createSpreadsheetFake(): SpreadsheetFake {
  const sheets = new Map<string, SheetFake>();
  let rangeCallCount = 0;
  let readListener: ((sheetName: string) => void) | null = null;
  let insideListener = false;

  function announceRead(sheetName: string): void {
    if (readListener === null || insideListener) return;

    insideListener = true;
    try {
      readListener(sheetName);
    } finally {
      insideListener = false;
    }
  }

  function buildSheet(sheet: SheetFake): unknown {
    return {
      getLastRow: (): number => sheet.rows.length,
      getLastColumn: (): number =>
        sheet.rows.reduce((widest, row) => Math.max(widest, row.length), 0),
      getMaxRows: (): number => Math.max(sheet.rows.length, 1_000),
      hideSheet: (): void => {
        sheet.hidden = true;
      },
      setFrozenRows: (rows: number): void => {
        sheet.frozenRows = rows;
      },
      getConditionalFormatRules: (): unknown[] =>
        sheet.conditionalRules.map((formula) => ({ formula })),
      setConditionalFormatRules: (rules: unknown[]): void => {
        sheet.conditionalRules = rules.map((rule) =>
          typeof rule === 'object' && rule !== null && 'formula' in rule
            ? String(rule.formula)
            : '',
        );
      },
      appendRow: (values: unknown[]): void => {
        sheet.rows.push(values.slice());
      },
      getRange: (row: number, column: number, numRows = 1, numColumns = 1) => {
        rangeCallCount += 1;
        return {
        getValue: (): unknown => {
          const value = sheet.rows[row - 1]?.[column - 1] ?? '';
          announceRead(sheet.name);
          return value;
        },
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
          /*
           * Announced AFTER the values are captured, not before.
           *
           * The window a concurrent execution is dangerous in is the one
           * between a read completing and the matching write — the caller is
           * now holding a snapshot that another execution can invalidate.
           * Firing before the copy would let an interrupted reader see the
           * intruder's writes, which is the one thing a real race never does.
           */
          announceRead(sheet.name);
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
        setNumberFormat: (format: string): void => {
          sheet.numberFormats.push(`${String(column)}:${format}`);
        },
        setHorizontalAlignment: (): void => undefined,
        setFontWeight: (): void => undefined,
        setDataValidation: (rule: unknown): void => {
          const values =
            typeof rule === 'object' && rule !== null && 'values' in rule
              ? (rule.values as string[])
              : [];
          sheet.validations.set(column, values);
        },
        };
      },
    };
  }

  const spreadsheet = {
    getSheetByName: (name: string): unknown =>
      sheets.has(name) ? buildSheet(sheets.get(name)!) : null,
    insertSheet: (name: string): unknown => {
      const sheet: SheetFake = {
        name,
        rows: [],
        numberFormats: [],
        validations: new Map<number, string[]>(),
        conditionalRules: [],
        frozenRows: 0,
        hidden: false,
      };
      sheets.set(name, sheet);
      return buildSheet(sheet);
    },
  };

  return {
    service: { openById: () => spreadsheet },
    sheets,
    dataRows: (name: string) => (sheets.get(name)?.rows ?? []).slice(1),
    formatting: (name: string) => sheets.get(name),
    rangeCalls: () => rangeCallCount,
    onRead: (listener) => {
      readListener = listener;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* LockService                                                                */
/* -------------------------------------------------------------------------- */

export interface LockFake {
  service: { getScriptLock: () => unknown; getUserLock: () => unknown };
  /** True while the lock is held. */
  isHeld: () => boolean;
  /** Number of successful acquisitions, for assertions. */
  acquisitions: () => number;
  /** Make the next tryLock fail, simulating contention. */
  failNextAcquisition: () => void;
  /** Every flush() call recorded, to prove durability before release. */
  flushes: () => number;
  recordFlush: () => void;
}

/**
 * A faithful lock fake.
 *
 * JavaScript is single-threaded, so a test cannot literally run two requests at
 * once. What it CAN prove is that the counter is never written while the lock
 * is not held — which is the actual invariant. `assertLockHeld` is called from
 * the counter fake, so a critical section that forgets to lock fails the test.
 */
export function createLockFake(): LockFake {
  let held = false;
  let acquired = 0;
  let flushCount = 0;
  let failNext = false;

  const lock = {
    tryLock: (_timeoutMs: number): boolean => {
      if (failNext) {
        failNext = false;
        return false;
      }
      if (held) return false;
      held = true;
      acquired += 1;
      return true;
    },
    waitLock: (_timeoutMs: number): void => {
      held = true;
      acquired += 1;
    },
    releaseLock: (): void => {
      held = false;
    },
    hasLock: (): boolean => held,
  };

  return {
    service: { getScriptLock: () => lock, getUserLock: () => lock },
    isHeld: () => held,
    acquisitions: () => acquired,
    failNextAcquisition: () => {
      failNext = true;
    },
    flushes: () => flushCount,
    recordFlush: () => {
      flushCount += 1;
    },
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
/* DriveApp                                                                   */
/* -------------------------------------------------------------------------- */

export interface DriveFileFake {
  id: string;
  name: string;
  mimeType: string;
  bytes: number[];
  folderId: string;
}

export interface DriveFake {
  service: unknown;
  /** The Advanced Drive Service (`Drive`), for content replacement. */
  advanced: unknown;
  files: () => DriveFileFake[];
  folderPath: (folderId: string) => string;
  /** Files in a folder, by the folder's path from the root. */
  filesIn: (path: string) => DriveFileFake[];
  /** Every folder path that exists, for asserting no duplicates were created. */
  folderPaths: () => string[];
  /** Every sharing call made. Must stay empty: nothing is ever made public. */
  sharingCalls: () => string[];
  /** Make the next createFile throw, to exercise the failure path. */
  failNextCreate: (message: string) => void;
  /** Make the next createFolder throw. */
  failNextFolder: (message: string) => void;
  /** Make `Drive.Files.update` throw on the next call. */
  failNextUpdate: (message: string) => void;
  /** Every `Drive.Files.update` call, as `fileId:byteLength`. */
  updateCalls: () => string[];
  /** Remove the Advanced Drive Service, as an unconfigured deployment would. */
  disableAdvancedService: () => void;
}

/**
 * A minimal in-memory Drive.
 *
 * Records sharing attempts rather than implementing them, so a test can assert
 * that nothing in the signature path ever tries to make a file public.
 */
export function createDriveFake(rootIdOrUndefined?: string): DriveFake {
  const rootId = rootIdOrUndefined ?? 'test-only-drive-root';

  interface FolderNode {
    id: string;
    name: string;
    parentId: string | null;
  }

  const folders = new Map<string, FolderNode>([[rootId, { id: rootId, name: '', parentId: null }]]);
  const files = new Map<string, DriveFileFake>();
  const sharing: string[] = [];

  let sequence = 0;
  let pendingFailure: string | null = null;
  let pendingFolderFailure: string | null = null;
  let pendingUpdateFailure: string | null = null;
  let advancedEnabled = true;
  const updates: string[] = [];

  function nextId(prefix: string): string {
    sequence += 1;
    // Drive ids are opaque but URL-safe and at least 8 characters; the branded
    // constructor enforces that, so the fake has to produce plausible ones.
    return `${prefix}-000000-${String(sequence)}`;
  }

  function pathOf(folderId: string): string {
    const segments: string[] = [];
    let current = folders.get(folderId);

    while (current !== undefined && current.parentId !== null) {
      segments.unshift(current.name);
      current = folders.get(current.parentId);
    }
    return segments.join('/');
  }

  function buildFile(file: DriveFileFake): unknown {
    return {
      getId: (): string => file.id,
      getName: (): string => file.name,
      getUrl: (): string => `https://drive.google.com/file/d/${file.id}/view`,
      getBlob: () => ({
        getBytes: (): number[] => file.bytes,
        getName: (): string => file.name,
      }),
      setSharing: (access: string): void => {
        sharing.push(`file:${file.id}:${access}`);
      },
      addViewer: (email: string): void => {
        sharing.push(`file:${file.id}:viewer:${email}`);
      },
      getDownloadUrl: (): string => {
        sharing.push(`file:${file.id}:downloadUrl`);
        return `https://drive.google.com/uc?id=${file.id}`;
      },
    };
  }

  interface BlobFake {
    getBytes: () => number[];
    getName: () => string;
    getContentType?: () => string;
  }

  function buildFolder(node: FolderNode): unknown {
    return {
      getId: (): string => node.id,
      getName: (): string => node.name,
      getUrl: (): string => `https://drive.google.com/drive/folders/${node.id}`,

      getFoldersByName: (name: string) => {
        const matches = [...folders.values()].filter(
          (entry) => entry.parentId === node.id && entry.name === name,
        );
        let index = 0;
        return {
          hasNext: (): boolean => index < matches.length,
          next: (): unknown => {
            const match = matches[index];
            index += 1;
            if (match === undefined) throw new Error('No such folder.');
            return buildFolder(match);
          },
        };
      },

      getFilesByName: (name: string) => {
        const matches = [...files.values()].filter(
          (file) => file.folderId === node.id && file.name === name,
        );
        let index = 0;
        return {
          hasNext: (): boolean => index < matches.length,
          next: (): unknown => {
            const match = matches[index];
            index += 1;
            if (match === undefined) throw new Error('No such file.');
            return buildFile(match);
          },
        };
      },

      createFolder: (name: string): unknown => {
        if (pendingFolderFailure !== null) {
          const message = pendingFolderFailure;
          pendingFolderFailure = null;
          throw new Error(message);
        }

        const created: FolderNode = { id: nextId('folder'), name, parentId: node.id };
        folders.set(created.id, created);
        return buildFolder(created);
      },

      createFile: (blob: BlobFake): unknown => {
        if (pendingFailure !== null) {
          const message = pendingFailure;
          pendingFailure = null;
          throw new Error(message);
        }

        const file: DriveFileFake = {
          id: nextId('file'),
          name: blob.getName(),
          mimeType: blob.getContentType?.() ?? 'image/png',
          bytes: blob.getBytes(),
          folderId: node.id,
        };
        files.set(file.id, file);
        return buildFile(file);
      },

      setSharing: (access: string): void => {
        sharing.push(`folder:${node.id}:${access}`);
      },
    };
  }

  const filesCollection = {
    update: (_resource: unknown, fileId: string, media: BlobFake): unknown => {
      if (pendingUpdateFailure !== null) {
        const message = pendingUpdateFailure;
        pendingUpdateFailure = null;
        throw new Error(message);
      }

      const file = files.get(fileId);
      if (file === undefined) throw new Error(`No file with id ${fileId}`);

      file.bytes = media.getBytes();
      updates.push(`${fileId}:${String(file.bytes.length)}`);
      return { id: file.id, name: file.name };
    },
  };

  const advancedService = {
    get Files(): unknown {
      return advancedEnabled ? filesCollection : undefined;
    },
  };

  return {
    service: {
      Access: { PRIVATE: 'PRIVATE', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
      Permission: { VIEW: 'VIEW', NONE: 'NONE' },

      getFolderById: (id: string): unknown => {
        const node = folders.get(id);
        if (node === undefined) throw new Error(`No folder with id ${id}`);
        return buildFolder(node);
      },

      getFileById: (id: string): unknown => {
        const file = files.get(id);
        if (file === undefined) throw new Error(`No file with id ${id}`);
        return buildFile(file);
      },
    },

    /**
     * The Advanced Drive Service.
     *
     * Only `Files.update` with media is used — content replacement, which
     * DriveApp cannot do at all. It keeps the file id and the URL, which is
     * what makes a retry replace rather than duplicate.
     *
     * `Files` is a getter so a test can take the service away mid-run, which is
     * what an Apps Script deployment that never enabled it looks like.
     */
    advanced: advancedService,

    files: () => [...files.values()],
    folderPath: pathOf,
    filesIn: (path: string) => [...files.values()].filter((file) => pathOf(file.folderId) === path),
    folderPaths: () =>
      [...folders.values()].filter((node) => node.parentId !== null).map((node) => pathOf(node.id)),
    sharingCalls: () => [...sharing],
    failNextCreate: (message: string) => {
      pendingFailure = message;
    },
    failNextFolder: (message: string) => {
      pendingFolderFailure = message;
    },
    failNextUpdate: (message: string) => {
      pendingUpdateFailure = message;
    },
    updateCalls: () => [...updates],
    disableAdvancedService: () => {
      advancedEnabled = false;
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
  lock: LockFake;
  drive: DriveFake;
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
  const lockFake = createLockFake();
  const driveFake = createDriveFake(propertiesFake.get('DRIVE_ROOT_FOLDER_ID'));

  stub('Utilities', createUtilitiesFakeWithBlobDecode());
  stub('DriveApp', driveFake.service);
  // The Advanced Drive Service, declared in appsscript.json. Only content
  // replacement uses it; everything else goes through DriveApp.
  stub('Drive', driveFake.advanced);
  stub('PropertiesService', propertiesFake.service);
  stub('CacheService', cacheFake.service);
  stub('ContentService', createContentServiceFake());
  stub('LockService', lockFake.service);
  // SpreadsheetApp.flush() has no effect on the fake store, but recording the
  // call lets a test assert the counter write was flushed before the lock was
  // released — the guarantee that stops a stale read handing out a used number.
  stub('SpreadsheetApp', {
    ...spreadsheetFake.service,
    flush: () => {
      lockFake.recordFlush();
    },
    /*
     * The builders the tracking sheet's formatting uses. They record intent
     * rather than implementing it: what a test needs to know is that the Status
     * column offers exactly three values, not how Sheets renders a dropdown.
     */
    newDataValidation: () => {
      let values: string[] = [];
      const builder = {
        requireValueInList: (list: string[]): unknown => {
          values = [...list];
          return builder;
        },
        setAllowInvalid: (): unknown => builder,
        build: (): unknown => ({ values }),
      };
      return builder;
    },
    newConditionalFormatRule: () => {
      let formula = '';
      const builder = {
        whenFormulaSatisfied: (value: string): unknown => {
          formula = value;
          return builder;
        },
        setBackground: (): unknown => builder,
        setRanges: (): unknown => builder,
        build: (): unknown => ({ formula }),
      };
      return builder;
    },
  });
  stub('console', { ...console, error: () => undefined, log: () => undefined });

  return {
    properties: propertiesFake,
    cache: cacheFake,
    spreadsheet: spreadsheetFake,
    lock: lockFake,
    drive: driveFake,
  };
}
