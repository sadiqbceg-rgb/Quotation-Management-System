/**
 * Writing one document into a quotation folder.
 *
 * See IMPLEMENTATION_PLAN.md §16.4.
 *
 * ---------------------------------------------------------------------------
 * REPLACE, NEVER DUPLICATE
 * ---------------------------------------------------------------------------
 * PRD §37 requires that retrying a failed save does not produce a second file.
 * Drive's default behaviour is the opposite: `createFile` with an existing name
 * happily makes another one, and the folder ends up holding
 * `SFC-RUH-QTN-2026-004.pdf` twice with no way to tell which the client was
 * sent.
 *
 * So an existing file of the target name has its CONTENT replaced through the
 * Advanced Drive Service. That keeps the file id, keeps the URL already shown
 * to the user or written to the tracking sheet, and leaves Drive's own revision
 * history as an audit trail of every retry — which is worth more than a new
 * file would be.
 *
 * A new file is created only when none exists.
 *
 * ---------------------------------------------------------------------------
 * NOTHING IS EVER SHARED
 * ---------------------------------------------------------------------------
 * No `setSharing`, no `addViewer`, no `ANYONE_WITH_LINK`. Files inherit the
 * archive's permissions and that is the whole permission model (§16.5). A test
 * asserts the Drive fake records zero sharing calls.
 */

import type { DocumentKind } from '@shared/drive-paths';
import type { DriveTarget } from '@shared/drive-links';
import { ApiError } from '../errors';
import type { ValidatedDocument } from '../validation/document-validator';
import { driveError } from './drive-errors';
import { targetOf } from './drive-urls';

/** Whether a file was created or an existing one was overwritten. */
export type UploadDisposition = 'created' | 'replaced';

export interface UploadedDocument extends DriveTarget {
  kind: DocumentKind;
  disposition: UploadDisposition;
  byteLength: number;
}

/** The existing file of this exact name in the folder, or null. */
export function findByName(
  folder: GoogleAppsScript.Drive.Folder,
  name: string,
): GoogleAppsScript.Drive.File | null {
  const found = folder.getFilesByName(name);
  return found.hasNext() ? found.next() : null;
}

function blobOf(document: ValidatedDocument, name: string): GoogleAppsScript.Base.Blob {
  return Utilities.newBlob(document.bytes, document.mimeType, name);
}

/**
 * Replace an existing file's content in place.
 *
 * `Drive.Files.update` is the Advanced Drive Service; DriveApp has no
 * content-replacing call at all. The service is declared in `appsscript.json`,
 * and its absence is reported as a Drive failure rather than a crash, because a
 * deployment that forgot to enable it must not look like a corrupt upload.
 */
function replaceContent(
  fileId: string,
  document: ValidatedDocument,
  name: string,
): GoogleAppsScript.Drive.File {
  const files = Drive.Files;
  if (files === undefined) {
    throw new ApiError(
      'DRIVE_UPLOAD_FAILED',
      'Google Drive is not fully configured for this deployment. Please contact an administrator.',
    );
  }

  try {
    // Metadata is left alone deliberately: the name is already correct, and
    // rewriting it on every retry would churn the revision history.
    files.update({}, fileId, blobOf(document, name));
  } catch (thrown: unknown) {
    throw driveError(thrown, 'DRIVE_UPLOAD_FAILED');
  }

  // Re-read through DriveApp so the URL comes from Drive itself (§16.5).
  return DriveApp.getFileById(fileId);
}

function createFile(
  folder: GoogleAppsScript.Drive.Folder,
  document: ValidatedDocument,
  name: string,
): GoogleAppsScript.Drive.File {
  try {
    return folder.createFile(blobOf(document, name));
  } catch (thrown: unknown) {
    throw driveError(thrown, 'DRIVE_UPLOAD_FAILED');
  }
}

/**
 * Upload a document, replacing any file already using its name.
 *
 * Idempotent by construction: called twice with the same folder and name, the
 * second call overwrites the first and returns the same file id.
 */
export function uploadOrReplace(
  folder: GoogleAppsScript.Drive.Folder,
  name: string,
  document: ValidatedDocument,
): UploadedDocument {
  const existing = findByName(folder, name);

  const file =
    existing === null
      ? createFile(folder, document, name)
      : replaceContent(existing.getId(), document, name);

  return {
    ...targetOf(file),
    kind: document.kind,
    disposition: existing === null ? 'created' : 'replaced',
    byteLength: document.byteLength,
  };
}
