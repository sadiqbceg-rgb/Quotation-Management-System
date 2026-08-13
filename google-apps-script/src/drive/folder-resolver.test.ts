/**
 * Folder resolution — get-or-create, and the lock that stops two `August`s.
 *
 * Every test runs against the in-memory Drive fake. Nothing here touches a real
 * Drive, and no test folder can therefore appear in the company's archive.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installGasFakes, type GasEnvironment } from '../__fixtures__/gas-fakes';
import { ApiError } from '../errors';
import {
  FOLDER_LOCK_TIMEOUT_MS,
  archiveRoot,
  getOrCreateFolder,
  resolveFolderPath,
} from './folder-resolver';

let env: GasEnvironment;

beforeEach(() => {
  vi.unstubAllGlobals();
  env = installGasFakes(vi.stubGlobal);
});

describe('the archive root', () => {
  it('comes from Script Properties, never from source', () => {
    expect(archiveRoot().getId()).toBe('test-only-drive-root');
  });

  it('reports a missing configuration as CONFIG_MISSING, naming the key', () => {
    env.properties.values.delete('DRIVE_ROOT_FOLDER_ID');

    expect(() => archiveRoot()).toThrow(/CONFIG_MISSING:DRIVE_ROOT_FOLDER_ID/);
  });

  it('reports an unreachable root as a Drive failure, not a crash', () => {
    env.properties.values.set('DRIVE_ROOT_FOLDER_ID', 'no-such-folder');

    expect(() => archiveRoot()).toThrow(ApiError);
    try {
      archiveRoot();
    } catch (error: unknown) {
      expect((error as ApiError).code).toBe('DRIVE_AUTH_FAILED');
    }
  });
});

describe('get or create', () => {
  it('creates a folder that is absent', () => {
    const created = getOrCreateFolder(archiveRoot(), '2026');

    expect(created.getName()).toBe('2026');
    expect(env.drive.folderPaths()).toContain('2026');
  });

  it('reuses an existing folder rather than making a second one', () => {
    const first = getOrCreateFolder(archiveRoot(), '2026');
    const second = getOrCreateFolder(archiveRoot(), '2026');

    expect(second.getId()).toBe(first.getId());
    expect(env.drive.folderPaths().filter((path) => path === '2026')).toHaveLength(1);
  });

  it('refuses a name that could escape the archive', () => {
    for (const name of ['..', '../2025', 'a/b', '.hidden']) {
      expect(() => getOrCreateFolder(archiveRoot(), name), name).toThrow(ApiError);
    }
  });

  it('reports a creation failure as DRIVE_FOLDER_CREATE_FAILED', () => {
    env.drive.failNextFolder('Service error');

    try {
      getOrCreateFolder(archiveRoot(), '2026');
      expect.unreachable('should have thrown');
    } catch (error: unknown) {
      expect((error as ApiError).code).toBe('DRIVE_FOLDER_CREATE_FAILED');
    }
  });

  it('classifies a quota failure specifically, so the message is actionable', () => {
    env.drive.failNextFolder('Storage quota exceeded');

    try {
      getOrCreateFolder(archiveRoot(), '2026');
      expect.unreachable('should have thrown');
    } catch (error: unknown) {
      expect((error as ApiError).code).toBe('DRIVE_QUOTA_EXCEEDED');
    }
  });
});

describe('resolving a path', () => {
  const PATH = ['2026', 'August', 'SFC-RUH-QTN-2026-004'];

  it('creates every missing level', () => {
    const folder = resolveFolderPath(PATH);

    expect(folder.getName()).toBe('SFC-RUH-QTN-2026-004');
    expect(env.drive.folderPath(folder.getId())).toBe('2026/August/SFC-RUH-QTN-2026-004');
  });

  it('reuses the whole path on a second call', () => {
    const first = resolveFolderPath(PATH);
    const second = resolveFolderPath(PATH);

    expect(second.getId()).toBe(first.getId());
    expect(env.drive.folderPaths().filter((path) => path === '2026')).toHaveLength(1);
    expect(env.drive.folderPaths().filter((path) => path === '2026/August')).toHaveLength(1);
  });

  it('creates exactly one month folder for two quotations in the same month', () => {
    // The race this whole lock exists for: Drive permits two folders named
    // `August` in the same parent, and nothing would report the split.
    resolveFolderPath(['2026', 'August', 'SFC-RUH-QTN-2026-004']);
    resolveFolderPath(['2026', 'August', 'SFC-RUH-QTN-2026-005']);

    expect(env.drive.folderPaths().filter((path) => path === '2026/August')).toHaveLength(1);
    expect(env.drive.folderPaths()).toContain('2026/August/SFC-RUH-QTN-2026-004');
    expect(env.drive.folderPaths()).toContain('2026/August/SFC-RUH-QTN-2026-005');
  });

  it('holds the lock across the whole walk, and always releases it', () => {
    expect(env.lock.isHeld()).toBe(false);

    resolveFolderPath(PATH);

    // One acquisition for the whole path, not one per level.
    expect(env.lock.acquisitions()).toBe(1);
    expect(env.lock.isHeld()).toBe(false);
  });

  it('releases the lock even when a level fails to create', () => {
    env.drive.failNextFolder('Service error');

    expect(() => resolveFolderPath(PATH)).toThrow(ApiError);
    expect(env.lock.isHeld()).toBe(false);
  });

  it('tells the caller to retry when the lock cannot be taken', () => {
    env.lock.failNextAcquisition();

    try {
      resolveFolderPath(PATH);
      expect.unreachable('should have thrown');
    } catch (error: unknown) {
      expect((error as ApiError).code).toBe('DRIVE_FOLDER_CREATE_FAILED');
      expect((error as ApiError).message).toMatch(/try again/i);
    }
  });

  it('waits no longer than Apps Script allows', () => {
    expect(FOLDER_LOCK_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  it('refuses an empty path rather than returning the archive root', () => {
    expect(() => resolveFolderPath([])).toThrow(ApiError);
  });

  it('never shares anything', () => {
    resolveFolderPath(PATH);
    expect(env.drive.sharingCalls()).toEqual([]);
  });
});
