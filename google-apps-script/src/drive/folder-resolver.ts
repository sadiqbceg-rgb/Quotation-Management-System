/**
 * Get-or-create folder resolution for the Drive archive.
 *
 * See IMPLEMENTATION_PLAN.md §16.3.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS NEEDS A LOCK
 * ---------------------------------------------------------------------------
 * Drive permits two folders with the same name in the same parent. So the
 * obvious implementation — "look for `August`, create it if absent" — creates a
 * SECOND `August` when two people save a quotation in the same second. Nothing
 * fails, nothing is logged, and from then on the month's quotations are split
 * across two folders that look identical in the Drive UI.
 *
 * The whole root → year → month → number walk therefore runs inside a script
 * lock. Apps Script has no keyed locks, so the lock is global; the critical
 * section is kept to folder lookups only, and NO UPLOAD ever happens inside it
 * (§15.6) — a 2 MB upload holding a global lock would serialise every user of
 * the deployment behind it.
 *
 * This is the single folder utility. Phase 06's signature storage uses it too.
 */

import { isSafePathSegment } from '@shared/drive-paths';
import { requireProperty } from '../config/properties';
import { ApiError } from '../errors';
import { driveError, isConfigMissing } from './drive-errors';

/**
 * How long to wait for the folder lock.
 *
 * Apps Script caps this at 30 s. Resolution is a handful of Drive lookups, so a
 * caller that cannot get in within the window is told to retry rather than
 * being queued behind something that is evidently stuck.
 */
export const FOLDER_LOCK_TIMEOUT_MS = 30_000;

/** Injectable so tests can drive the lock and assert the critical section. */
export interface FolderLock {
  tryLock: (timeoutMs: number) => boolean;
  releaseLock: () => void;
}

function defaultLock(): FolderLock {
  // getScriptLock, not getUserLock: two DIFFERENT users saving in the same
  // month is precisely the race being prevented.
  return LockService.getScriptLock();
}

/** The archive root, from Script Properties. Never a hard-coded id (§19.7). */
export function archiveRoot(): GoogleAppsScript.Drive.Folder {
  try {
    return DriveApp.getFolderById(requireProperty('DRIVE_ROOT_FOLDER_ID'));
  } catch (thrown: unknown) {
    if (isConfigMissing(thrown)) throw thrown;
    throw driveError(thrown, 'DRIVE_AUTH_FAILED');
  }
}

/**
 * One level: return the existing child of this exact name, or create it.
 *
 * Always reuses an existing folder. Creating a second one with the same name is
 * legal in Drive and is exactly the failure this exists to prevent.
 */
export function getOrCreateFolder(
  parent: GoogleAppsScript.Drive.Folder,
  name: string,
): GoogleAppsScript.Drive.Folder {
  if (!isSafePathSegment(name)) {
    // Nothing user-typed should reach here — the path is built from a validated
    // number and date — so a bad segment means something upstream is wrong.
    throw new ApiError('VALIDATION_FAILED', 'That folder name cannot be used in Google Drive.');
  }

  const existing = parent.getFoldersByName(name);
  if (existing.hasNext()) return existing.next();

  try {
    return parent.createFolder(name);
  } catch (thrown: unknown) {
    throw driveError(thrown, 'DRIVE_FOLDER_CREATE_FAILED');
  }
}

export interface ResolveDependencies {
  lock?: FolderLock;
}

/**
 * Walk a root-relative path, creating what is missing.
 *
 * The whole walk is one critical section. Locking each level separately would
 * leave the same race one level down.
 */
export function resolveFolderPath(
  segments: readonly string[],
  dependencies: ResolveDependencies = {},
): GoogleAppsScript.Drive.Folder {
  if (segments.length === 0) {
    throw new ApiError('VALIDATION_FAILED', 'An archive path is required.');
  }

  const lock = dependencies.lock ?? defaultLock();

  if (!lock.tryLock(FOLDER_LOCK_TIMEOUT_MS)) {
    // Retryable, and the client is told so: the next attempt reuses the same
    // draft id and therefore lands in the same folder.
    throw new ApiError(
      'DRIVE_FOLDER_CREATE_FAILED',
      'The system is busy organising the document archive. Please try again.',
    );
  }

  try {
    let folder = archiveRoot();
    for (const segment of segments) {
      folder = getOrCreateFolder(folder, segment);
    }
    return folder;
  } finally {
    // Always released — including when a level fails to create.
    lock.releaseLock();
  }
}
