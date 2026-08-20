/**
 * Drive failure diagnostics (W-1).
 *
 * The defect these guard: a Drive refusal was classified into a generic code
 * and its original text discarded, so the client was told "saving to Google
 * Drive failed" and the server kept no record of why. A partial upload was
 * worse still — the error never reached the router at all, because it was
 * converted into an outcome.
 *
 * Two properties have to hold together, and neither alone is enough:
 *
 *   1. the reason survives, on the SERVER;
 *   2. it never reaches the client.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../errors';
import { classifyDriveError, driveError } from './drive-errors';

const QUOTA_MESSAGE = 'TEST_ONLY user storage quota has been exceeded for folder 1AbC-secret-id';
const PERMISSION_MESSAGE = 'TEST_ONLY you do not have permission to access operator@example.invalid';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('classification', () => {
  it('still recognises a quota failure and a permission failure', () => {
    expect(classifyDriveError(new Error(QUOTA_MESSAGE))).toBe('DRIVE_QUOTA_EXCEEDED');
    expect(classifyDriveError(new Error(PERMISSION_MESSAGE))).toBe('DRIVE_AUTH_FAILED');
  });

  it('leaves an unrecognised failure to the caller\'s fallback', () => {
    expect(classifyDriveError(new Error('TEST_ONLY something new'))).toBeNull();
  });
});

describe('the typed error', () => {
  it('keeps the taxonomy intact', () => {
    const error = driveError(new Error(QUOTA_MESSAGE), 'DRIVE_UPLOAD_FAILED');

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('DRIVE_QUOTA_EXCEEDED');
  });

  it('falls back to the caller\'s code when nothing identifies the cause', () => {
    expect(driveError(new Error('TEST_ONLY opaque'), 'DRIVE_UPLOAD_FAILED').code).toBe(
      'DRIVE_UPLOAD_FAILED',
    );
  });

  it('carries the original reason on `detail`, for the log', () => {
    // This is the whole fix: the reason used to be thrown away here.
    expect(driveError(new Error(QUOTA_MESSAGE), 'DRIVE_UPLOAD_FAILED').detail).toBe(QUOTA_MESSAGE);
  });

  it('handles a non-Error throwable without losing it', () => {
    expect(driveError('TEST_ONLY plain string failure', 'DRIVE_UPLOAD_FAILED').detail).toBe(
      'TEST_ONLY plain string failure',
    );
  });

  it('keeps the USER-facing message generic, naming no folder and no account', () => {
    const error = driveError(new Error(QUOTA_MESSAGE), 'DRIVE_UPLOAD_FAILED');

    expect(error.message).not.toContain('1AbC-secret-id');
    expect(error.message).not.toContain('TEST_ONLY');
    expect(error.message).toBe('Google Drive is out of space. Free some space and try again.');
  });

  it('keeps an account address out of the user-facing message too', () => {
    const error = driveError(new Error(PERMISSION_MESSAGE), 'DRIVE_UPLOAD_FAILED');

    expect(error.message).not.toContain('operator@example.invalid');
    expect(error.message).toBe('The application could not access Google Drive.');
  });

  it('still rethrows a configuration failure untouched', () => {
    // CONFIG_MISSING is the router's to handle, and naming the missing property
    // is the entire point of it.
    expect(() => driveError(new Error('CONFIG_MISSING: DRIVE_ROOT_FOLDER_ID'), 'DRIVE_UPLOAD_FAILED'))
      .toThrow(/CONFIG_MISSING/);
  });
});

describe('`detail` is log-only', () => {
  it('is not enumerable in the shape the client body is built from', () => {
    const error = driveError(new Error(QUOTA_MESSAGE), 'DRIVE_UPLOAD_FAILED');

    /*
     * `failure()` in main.ts builds `{code, message, fields}` — it does not
     * spread the error. This asserts the contract that keeps `detail` server
     * side: anything that DID serialise the error wholesale would leak it, so
     * the body is constructed field by field.
     */
    const body = {
      code: error.code,
      message: error.message,
      ...(error.fields === undefined ? {} : { fields: error.fields }),
    };

    expect(JSON.stringify(body)).not.toContain('1AbC-secret-id');
    expect(JSON.stringify(body)).not.toContain(QUOTA_MESSAGE);
    expect(Object.keys(body)).toEqual(['code', 'message']);
  });
});
